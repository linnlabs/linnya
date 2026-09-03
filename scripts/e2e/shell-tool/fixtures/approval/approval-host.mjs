import { spawn } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';

import {
  parseCommandApprovalReply,
  parseCommandApprovalRequest,
  parseCommandApprovalSettlement,
} from '../../../../../packages/schemas/src/commands/index.ts';
import {
  acceptCommandApprovalReply,
} from '../../../../../src/domains/commands/features/command-authorization/functions/acceptCommandApprovalReply.ts';
import {
  advanceCommandApprovalSettlement,
} from '../../../../../src/domains/commands/features/command-authorization/functions/advanceCommandApprovalSettlement.ts';

const pending = new Map();
const approvalMemoryRoot = process.env.LINNYA_APPROVAL_HARNESS_MEMORY_ROOT;
const persistenceFailureRequestId = process.env.LINNYA_APPROVAL_HARNESS_FAIL_PERSIST_REQUEST_ID;
const persistenceBarrierRequestId = process.env.LINNYA_APPROVAL_HARNESS_BARRIER_REQUEST_ID;
const persistenceBarrier = persistenceBarrierRequestId
  ? createBarrier()
  : undefined;
let ownerEnded = false;
let spawnCount = 0;

function createBarrier() {
  let markStarted;
  let release;
  const started = new Promise(resolve => {
    markStarted = resolve;
  });
  const released = new Promise(resolve => {
    release = resolve;
  });
  return { started, markStarted, released, release };
}

function send(messageId, payload) {
  process.stdout.write(`${JSON.stringify({ message_id: messageId, ...payload })}\n`);
}

function createSettlementBase(request) {
  return {
    protocol_version: 1,
    kind: 'command_approval_settlement',
    approval_request_id: request.approval_request_id,
    proposal_identity: request.proposal.identity,
    settled_at_ms: Date.now(),
  };
}

function settle(state, settlement) {
  // 持久化会跨越异步边界；继续使用进入审批时捕获的 state 会让 owner 已结束的
  // request 被迟到结果重新批准。终态竞争必须回到 host 当前事实再结算。
  const currentState = pending.get(state.request.approval_request_id) ?? state;
  const advanced = advanceCommandApprovalSettlement({ state: currentState, settlement });
  if (advanced.status === 'accepted') {
    pending.set(state.request.approval_request_id, advanced.state);
  }
  return advanced;
}

async function persistConversationApproval(request, candidate) {
  if (request.approval_request_id === persistenceFailureRequestId) {
    throw new Error('intentional conversation approval persistence failure');
  }
  if (!approvalMemoryRoot) throw new Error('approval memory root is unavailable');

  if (request.approval_request_id === persistenceBarrierRequestId) {
    persistenceBarrier.markStarted();
    await persistenceBarrier.released;
  }

  await mkdir(approvalMemoryRoot, { recursive: true });
  const memoryPath = path.join(approvalMemoryRoot, `${request.approval_request_id}.json`);
  await writeFile(memoryPath, JSON.stringify({
    version: 1,
    conversation_id: request.proposal.identity.conversation_id,
    token_prefix: candidate.token_prefix,
    matching_context: candidate.matching_context,
  }), { encoding: 'utf8', flag: 'wx' });
  return memoryPath;
}

function runApprovedProposal(proposal) {
  spawnCount += 1;
  const isWindows = process.platform === 'win32';
  const executable = isWindows ? 'powershell.exe' : '/bin/zsh';
  const argv = isWindows
    ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', proposal.command]
    : ['-f', '-c', proposal.command];

  const child = spawn(executable, argv, {
    cwd: proposal.cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume();
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    stderr = `${stderr}${chunk}`.slice(-16_384);
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code !== 0) {
        reject(new Error(
          `approved proposal failed: code=${code} signal=${signal ?? 'none'} stderr=${stderr.trim()}`,
        ));
        return;
      }
      resolve({ code, signal });
    });
  });
}

async function handleSubmit(messageId, rawRequest) {
  const request = parseCommandApprovalRequest(rawRequest);
  if (ownerEnded) {
    send(messageId, { status: 'rejected', code: 'owner_ended', spawn_count: spawnCount });
    return;
  }
  if (pending.has(request.approval_request_id)) {
    send(messageId, { status: 'rejected', code: 'duplicate_request', spawn_count: spawnCount });
    return;
  }
  pending.set(request.approval_request_id, { status: 'pending', request });
  send(messageId, {
    status: 'accepted',
    approval_request_id: request.approval_request_id,
    spawn_count: spawnCount,
  });
}

async function handleReply(messageId, rawReply) {
  const reply = parseCommandApprovalReply(rawReply);
  const state = pending.get(reply.approval_request_id);
  if (!state) {
    send(messageId, { status: 'stale', code: 'unknown_request', spawn_count: spawnCount });
    return;
  }
  if (state.status === 'settled') {
    send(messageId, {
      status: 'stale',
      code: 'already_settled',
      settlement: state.settlement,
      spawn_count: spawnCount,
    });
    return;
  }

  const accepted = acceptCommandApprovalReply({ request: state.request, reply });
  if (accepted.status === 'rejected') {
    send(messageId, { status: 'stale', code: accepted.code, spawn_count: spawnCount });
    return;
  }

  const base = createSettlementBase(state.request);
  if (accepted.decision.type === 'reject') {
    const settlement = parseCommandApprovalSettlement({
      ...base,
      outcome: 'rejected',
      reason: 'user_rejected',
    });
    const advanced = settle(state, settlement);
    if (advanced.status === 'stale') {
      send(messageId, {
        status: 'stale',
        code: advanced.code,
        settlement: advanced.state.settlement,
        spawn_count: spawnCount,
      });
      return;
    }
    send(messageId, { status: 'settled', settlement, spawn_count: spawnCount });
    return;
  }

  let approvalMemoryPath;
  if (accepted.decision.type === 'approve_for_conversation') {
    try {
      approvalMemoryPath = await persistConversationApproval(
        state.request,
        accepted.decision.candidate,
      );
    } catch {
      const settlement = parseCommandApprovalSettlement({
        ...base,
        outcome: 'failed',
        failure: 'conversation_approval_persistence_failed',
      });
      const advanced = settle(state, settlement);
      if (advanced.status === 'stale') {
        send(messageId, {
          status: 'stale',
          code: advanced.code,
          settlement: advanced.state.settlement,
          spawn_count: spawnCount,
        });
        return;
      }
      send(messageId, { status: 'settled', settlement, spawn_count: spawnCount });
      return;
    }
  }

  const choice = accepted.decision.type === 'approve_once'
    ? 'allow_once'
    : 'allow_for_conversation';
  const settlement = parseCommandApprovalSettlement({
    ...base,
    outcome: 'approved',
    choice,
    permission: accepted.decision.permission,
  });
  const advanced = settle(state, settlement);
  if (advanced.status === 'stale') {
    if (approvalMemoryPath) {
      await unlink(approvalMemoryPath);
    }
    send(messageId, {
      status: 'stale',
      code: advanced.code,
      settlement: advanced.state.settlement,
      spawn_count: spawnCount,
    });
    return;
  }
  await runApprovedProposal(state.request.proposal);
  send(messageId, {
    status: 'settled',
    settlement,
    approval_memory_path: approvalMemoryPath,
    spawn_count: spawnCount,
  });
}

function handleEndOwner(messageId) {
  let invalidated = 0;
  for (const state of pending.values()) {
    if (state.status === 'settled') continue;
    const settlement = parseCommandApprovalSettlement({
      ...createSettlementBase(state.request),
      outcome: 'invalidated',
      reason: 'owner_ended',
    });
    settle(state, settlement);
    invalidated += 1;
  }
  ownerEnded = true;
  send(messageId, { status: 'owner_ended', invalidated, spawn_count: spawnCount });
}

async function dispatch(message) {
  const messageId = typeof message?.message_id === 'string' ? message.message_id : undefined;
  if (!messageId) throw new Error('message_id is required');

  if (message.type === 'submit') {
    await handleSubmit(messageId, message.request);
    return;
  }
  if (message.type === 'reply') {
    await handleReply(messageId, message.reply);
    return;
  }
  if (message.type === 'end_owner') {
    handleEndOwner(messageId);
    return;
  }
  if (message.type === 'wait_persistence_started') {
    if (!persistenceBarrier || message.approval_request_id !== persistenceBarrierRequestId) {
      throw new Error('unknown persistence barrier');
    }
    await persistenceBarrier.started;
    send(messageId, { status: 'persistence_started', spawn_count: spawnCount });
    return;
  }
  if (message.type === 'release_persistence') {
    if (!persistenceBarrier || message.approval_request_id !== persistenceBarrierRequestId) {
      throw new Error('unknown persistence barrier');
    }
    persistenceBarrier.release();
    send(messageId, { status: 'persistence_released', spawn_count: spawnCount });
    return;
  }
  throw new Error('unknown approval harness message');
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const inFlightMessages = new Set();
for await (const line of lines) {
  let messageId;
  try {
    const message = JSON.parse(line);
    messageId = message?.message_id;
    const inFlight = dispatch(message).catch(error => {
      send(typeof messageId === 'string' ? messageId : 'invalid', {
        status: 'error',
        code: 'invalid_message',
        detail: error instanceof Error ? error.message : String(error),
        spawn_count: spawnCount,
      });
    });
    inFlightMessages.add(inFlight);
    void inFlight.finally(() => inFlightMessages.delete(inFlight));
  } catch (error) {
    send(typeof messageId === 'string' ? messageId : 'invalid', {
      status: 'error',
      code: 'invalid_message',
      detail: error instanceof Error ? error.message : String(error),
      spawn_count: spawnCount,
    });
  }
}

if (!ownerEnded) handleEndOwner('stdin_closed');
if (persistenceBarrier) persistenceBarrier.release();
await Promise.all(inFlightMessages);
