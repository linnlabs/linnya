import assert from 'node:assert/strict';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import {
  parseCommandApprovalReply,
  parseCommandApprovalRequest,
} from '../../../packages/schemas/src/commands/index.ts';
import { startApprovalHost } from './harness/approvalHost.mjs';
import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import { isProcessAlive, wait } from './harness/processObservation.mjs';

const approvedCommandFixturePath = process.env.LINNYA_APPROVAL_HARNESS_COMMAND_FIXTURE
  ?? fileURLToPath(new URL('./fixtures/approval/approved-command.mjs', import.meta.url));

function quotePosix(value) {
  return `'${value.split("'").join("'\"'\"'")}'`;
}

function quotePowerShell(value) {
  return `'${value.split("'").join("''")}'`;
}

function createApprovedCommand({ markerPath, runToken, requiredApprovalMemoryPath }) {
  const values = [
    process.execPath,
    approvedCommandFixturePath,
    markerPath,
    runToken,
    requiredApprovalMemoryPath ?? '',
  ];
  if (process.platform === 'win32') {
    return `& ${values.map(quotePowerShell).join(' ')}`;
  }
  return values.map(quotePosix).join(' ');
}

function createApprovalRequest(params) {
  const requestId = params.requestId ?? `command_approval_${randomUUID()}`;
  const identity = {
    conversation_id: params.conversationId ?? 'approval-harness-conversation',
    agent_run_id: params.agentRunId ?? `approval-harness-run-${randomUUID()}`,
    origin_tool_call_id: params.originToolCallId ?? `approval-harness-call-${randomUUID()}`,
    command_execution_id: `command_execution_${randomUUID()}`,
    owner_generation_id: params.ownerGenerationId,
    created_at_ms: Date.now(),
  };
  const baseLevel = params.baseLevel ?? 'read_only';
  const rememberable = params.rememberable === true;
  return parseCommandApprovalRequest({
    protocol_version: 1,
    kind: 'command_approval_request',
    approval_request_id: requestId,
    proposal: {
      protocol_version: 1,
      kind: 'shell_command_proposal',
      identity,
      command: createApprovedCommand({
        markerPath: params.markerPath,
        runToken: params.runToken,
        requiredApprovalMemoryPath: params.requiredApprovalMemoryPath,
      }),
      cwd: params.runRoot,
      permission: {
        protocol_version: 1,
        kind: 'command_permission_snapshot',
        identity,
        base_level: baseLevel,
        effective_level: baseLevel,
        grant_source: 'global_setting',
        internal_data_access: params.internalDataAccess ?? 'allowed',
      },
    },
    reasons: baseLevel === 'read_only'
      ? [{
          type: 'permission_elevation',
          from_level: 'read_only',
          to_level: 'standard',
        }]
      : [{
          type: 'fixed_risk_rule',
          rule_id: `${process.platform}.delete.harness-fixture`,
          category: 'delete',
        }],
    available_choices: rememberable
      ? ['allow_once', 'allow_for_conversation', 'deny']
      : ['allow_once', 'deny'],
    conversation_candidate: rememberable
      ? {
          token_prefix: [process.execPath, approvedCommandFixturePath],
          matching_context: {
            platform: process.platform === 'win32' ? 'windows' : 'macos',
            shell_semantics_id: process.platform === 'win32'
              ? 'windows-powershell-5.1'
              : 'zsh',
            matcher_revision: 'approval-harness-v1',
          },
        }
      : undefined,
    requested_at_ms: Date.now(),
  });
}

function createReply(request, choice) {
  return parseCommandApprovalReply({
    protocol_version: 1,
    kind: 'command_approval_reply',
    approval_request_id: request.approval_request_id,
    choice,
  });
}

async function expectPathMissing(targetPath) {
  await assert.rejects(access(targetPath), error => error?.code === 'ENOENT');
}

async function readExecutionEvidence(markerPath, expectedRunToken) {
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  assert.equal(marker.version, 1);
  assert.equal(marker.runToken, expectedRunToken);
  assert(Number.isSafeInteger(marker.pid) && marker.pid > 0);
  assert.equal(isProcessAlive(marker.pid), false, 'approved fixture must close before host replies');

  const heartbeat = (await readFile(`${markerPath}.heartbeat`, 'utf8'))
    .trim()
    .split('\n')
    .map(line => line.split('\t'));
  assert.equal(heartbeat.length, 3);
  assert(heartbeat.every(([token, pid]) => (
    token === expectedRunToken && Number(pid) === marker.pid
  )));
  assert.deepEqual(heartbeat.map(([, , sequence]) => Number(sequence)), [1, 2, 3]);
  return marker;
}

async function withApprovalHost(options, run) {
  const isolatedRoot = await createIsolatedRunRoot();
  const approvalMemoryRoot = path.join(isolatedRoot.path, 'approval-memory');
  const host = startApprovalHost({
    approvalMemoryRoot,
    persistenceFailureRequestId: options?.persistenceFailureRequestId,
    persistenceBarrierRequestId: options?.persistenceBarrierRequestId,
  });
  let primaryError;
  try {
    await run({ runRoot: isolatedRoot.path, approvalMemoryRoot, host });
  } catch (error) {
    primaryError = error;
  }

  let teardownError;
  try {
    await host.teardown();
  } catch (error) {
    teardownError = error;
  }
  if (!teardownError) {
    await isolatedRoot.cleanup();
  }

  if (primaryError && teardownError) {
    const failure = new AggregateError(
      [primaryError, teardownError],
      `审批测试主体和 host 收尾同时失败；现场保留在 ${isolatedRoot.path}`,
    );
    failure.preserveRunRootPath = isolatedRoot.path;
    throw failure;
  }
  if (teardownError) {
    const failure = new Error(
      `审批 host 收尾失败；现场保留在 ${isolatedRoot.path}`,
      { cause: teardownError },
    );
    failure.preserveRunRootPath = isolatedRoot.path;
    throw failure;
  }
  if (primaryError) throw primaryError;
}

async function verifyApprovalBeforeSpawnAndProposalIntegrity() {
  await withApprovalHost({}, async ({ runRoot, host }) => {
    const markerPath = path.join(runRoot, 'immutable-proposal.json');
    const runToken = randomUUID();
    const request = createApprovalRequest({
      runRoot,
      markerPath,
      runToken,
      ownerGenerationId: `command_owner_${randomUUID()}`,
    });

    const submitted = await host.send({ type: 'submit', request });
    assert.equal(submitted.status, 'accepted');
    assert.equal(submitted.spawn_count, 0);
    await wait(100);
    await Promise.all([
      expectPathMissing(markerPath),
      expectPathMissing(`${markerPath}.heartbeat`),
    ]);

    const tampered = await host.send({
      type: 'reply',
      reply: {
        ...createReply(request, 'allow_once'),
        command: 'different command',
        cwd: path.dirname(runRoot),
      },
    });
    assert.equal(tampered.status, 'error');
    assert.equal(tampered.code, 'invalid_message');
    assert.equal(tampered.spawn_count, 0);
    await expectPathMissing(markerPath);

    const approved = await host.send({
      type: 'reply',
      reply: createReply(request, 'allow_once'),
    });
    assert.equal(approved.status, 'settled');
    assert.equal(approved.settlement.outcome, 'approved');
    assert.equal(approved.settlement.choice, 'allow_once');
    assert.equal(approved.spawn_count, 1);
    await readExecutionEvidence(markerPath, runToken);

    const lateReply = await host.send({
      type: 'reply',
      reply: createReply(request, 'deny'),
    });
    assert.equal(lateReply.status, 'stale');
    assert.equal(lateReply.code, 'already_settled');
    assert.equal(lateReply.spawn_count, 1);
  });
}

async function verifyConcurrentReverseReplyRouting() {
  await withApprovalHost({}, async ({ runRoot, host }) => {
    const ownerGenerationId = `command_owner_${randomUUID()}`;
    const firstMarker = path.join(runRoot, 'first-command.json');
    const secondMarker = path.join(runRoot, 'second-command.json');
    const firstRequest = createApprovalRequest({
      runRoot,
      markerPath: firstMarker,
      runToken: 'first-token',
      ownerGenerationId,
    });
    const secondRequest = createApprovalRequest({
      runRoot,
      markerPath: secondMarker,
      runToken: 'second-token',
      ownerGenerationId,
    });

    await Promise.all([
      host.send({ type: 'submit', request: firstRequest }),
      host.send({ type: 'submit', request: secondRequest }),
    ]);
    const approvedSecond = await host.send({
      type: 'reply',
      reply: createReply(secondRequest, 'allow_once'),
    });
    const rejectedFirst = await host.send({
      type: 'reply',
      reply: createReply(firstRequest, 'deny'),
    });

    assert.equal(approvedSecond.settlement.proposal_identity.command_execution_id,
      secondRequest.proposal.identity.command_execution_id);
    assert.equal(rejectedFirst.settlement.proposal_identity.command_execution_id,
      firstRequest.proposal.identity.command_execution_id);
    assert.equal(rejectedFirst.settlement.outcome, 'rejected');
    assert.equal(rejectedFirst.spawn_count, 1);
    await readExecutionEvidence(secondMarker, 'second-token');
    await Promise.all([
      expectPathMissing(firstMarker),
      expectPathMissing(`${firstMarker}.heartbeat`),
    ]);
  });
}

async function verifyOwnerEndInvalidatesPending() {
  await withApprovalHost({}, async ({ runRoot, host }) => {
    const markerPath = path.join(runRoot, 'owner-ended-command.json');
    const ownerGenerationId = `command_owner_${randomUUID()}`;
    const request = createApprovalRequest({
      runRoot,
      markerPath,
      runToken: randomUUID(),
      ownerGenerationId,
    });
    await host.send({ type: 'submit', request });

    const ended = await host.send({ type: 'end_owner' });
    assert.equal(ended.status, 'owner_ended');
    assert.equal(ended.invalidated, 1);
    assert.equal(ended.spawn_count, 0);

    const lateReply = await host.send({
      type: 'reply',
      reply: createReply(request, 'allow_once'),
    });
    assert.equal(lateReply.status, 'stale');
    assert.equal(lateReply.code, 'already_settled');
    assert.equal(lateReply.spawn_count, 0);
    await expectPathMissing(markerPath);

    const nextRequest = createApprovalRequest({
      runRoot,
      markerPath: path.join(runRoot, 'after-owner-end.json'),
      runToken: randomUUID(),
      ownerGenerationId,
    });
    const rejected = await host.send({ type: 'submit', request: nextRequest });
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.code, 'owner_ended');
  });
}

async function verifyConversationApprovalPersistenceBoundary() {
  const failureRequestId = `command_approval_${randomUUID()}`;
  await withApprovalHost({ persistenceFailureRequestId: failureRequestId }, async ({
    runRoot,
    approvalMemoryRoot,
    host,
  }) => {
    const markerPath = path.join(runRoot, 'persistence-failed-command.json');
    const memoryPath = path.join(approvalMemoryRoot, `${failureRequestId}.json`);
    const request = createApprovalRequest({
      requestId: failureRequestId,
      runRoot,
      markerPath,
      runToken: randomUUID(),
      ownerGenerationId: `command_owner_${randomUUID()}`,
      rememberable: true,
      requiredApprovalMemoryPath: memoryPath,
    });
    await host.send({ type: 'submit', request });
    const failed = await host.send({
      type: 'reply',
      reply: createReply(request, 'allow_for_conversation'),
    });

    assert.equal(failed.settlement.outcome, 'failed');
    assert.equal(failed.settlement.failure, 'conversation_approval_persistence_failed');
    assert.equal(failed.spawn_count, 0);
    await Promise.all([expectPathMissing(memoryPath), expectPathMissing(markerPath)]);
  });

  await withApprovalHost({}, async ({ runRoot, approvalMemoryRoot, host }) => {
    const requestId = `command_approval_${randomUUID()}`;
    const markerPath = path.join(runRoot, 'persistence-succeeded-command.json');
    const memoryPath = path.join(approvalMemoryRoot, `${requestId}.json`);
    const runToken = randomUUID();
    const request = createApprovalRequest({
      requestId,
      runRoot,
      markerPath,
      runToken,
      ownerGenerationId: `command_owner_${randomUUID()}`,
      rememberable: true,
      requiredApprovalMemoryPath: memoryPath,
    });
    await host.send({ type: 'submit', request });
    const approved = await host.send({
      type: 'reply',
      reply: createReply(request, 'allow_for_conversation'),
    });

    assert.equal(approved.settlement.outcome, 'approved');
    assert.equal(approved.settlement.choice, 'allow_for_conversation');
    assert.equal(approved.approval_memory_path, memoryPath);
    assert.equal(approved.spawn_count, 1);
    const memory = JSON.parse(await readFile(memoryPath, 'utf8'));
    assert.deepEqual(memory.token_prefix, [process.execPath, approvedCommandFixturePath]);
    assert.deepEqual(memory.matching_context, request.conversation_candidate.matching_context);
    await readExecutionEvidence(markerPath, runToken);
  });

  const racingRequestId = `command_approval_${randomUUID()}`;
  await withApprovalHost({ persistenceBarrierRequestId: racingRequestId }, async ({
    runRoot,
    approvalMemoryRoot,
    host,
  }) => {
    const markerPath = path.join(runRoot, 'owner-won-persistence-race.json');
    const memoryPath = path.join(approvalMemoryRoot, `${racingRequestId}.json`);
    const request = createApprovalRequest({
      requestId: racingRequestId,
      runRoot,
      markerPath,
      runToken: randomUUID(),
      ownerGenerationId: `command_owner_${randomUUID()}`,
      rememberable: true,
      requiredApprovalMemoryPath: memoryPath,
    });
    await host.send({ type: 'submit', request });

    const reply = host.send({
      type: 'reply',
      reply: createReply(request, 'allow_for_conversation'),
    });
    const started = await host.send({
      type: 'wait_persistence_started',
      approval_request_id: racingRequestId,
    });
    assert.equal(started.status, 'persistence_started');

    const ended = await host.send({ type: 'end_owner' });
    assert.equal(ended.status, 'owner_ended');
    assert.equal(ended.invalidated, 1);
    const released = await host.send({
      type: 'release_persistence',
      approval_request_id: racingRequestId,
    });
    assert.equal(released.status, 'persistence_released');

    const stale = await reply;
    assert.equal(stale.status, 'stale');
    assert.equal(stale.code, 'already_settled');
    assert.equal(stale.settlement.outcome, 'invalidated');
    assert.equal(stale.settlement.reason, 'owner_ended');
    assert.equal(stale.spawn_count, 0);
    await Promise.all([
      expectPathMissing(memoryPath),
      expectPathMissing(markerPath),
      expectPathMissing(`${markerPath}.heartbeat`),
    ]);
  });
}

async function verifySubmittedPermissionSnapshotsStayIsolated() {
  await withApprovalHost({}, async ({ runRoot, host }) => {
    const ownerGenerationId = `command_owner_${randomUUID()}`;
    const oldRequest = createApprovalRequest({
      runRoot,
      markerPath: path.join(runRoot, 'old-snapshot.json'),
      runToken: 'old-snapshot',
      ownerGenerationId,
      baseLevel: 'read_only',
      internalDataAccess: 'denied',
    });
    await host.send({ type: 'submit', request: oldRequest });

    const nextRequest = createApprovalRequest({
      runRoot,
      markerPath: path.join(runRoot, 'new-snapshot.json'),
      runToken: 'new-snapshot',
      ownerGenerationId,
      baseLevel: 'standard',
      internalDataAccess: 'allowed',
    });
    await host.send({ type: 'submit', request: nextRequest });

    const oldApproved = await host.send({
      type: 'reply',
      reply: createReply(oldRequest, 'allow_once'),
    });
    const nextRejected = await host.send({
      type: 'reply',
      reply: createReply(nextRequest, 'deny'),
    });

    assert.equal(oldApproved.settlement.permission.base_level, 'read_only');
    assert.equal(oldApproved.settlement.permission.effective_level, 'standard');
    assert.equal(oldApproved.settlement.permission.internal_data_access, 'denied');
    assert.equal(nextRejected.settlement.proposal_identity.command_execution_id,
      nextRequest.proposal.identity.command_execution_id);
    assert.equal(nextRejected.settlement.outcome, 'rejected');
  });
}

await verifyApprovalBeforeSpawnAndProposalIntegrity();
await verifyConcurrentReverseReplyRouting();
await verifyOwnerEndInvalidatesPending();
await verifyConversationApprovalPersistenceBoundary();
await verifySubmittedPermissionSnapshotsStayIsolated();

console.log(
  `[shell-tool-approval-contract] ${process.platform} 不可变提案、审批前零副作用、并发路由、持久化竞态和 owner 失效合同通过。`,
);
