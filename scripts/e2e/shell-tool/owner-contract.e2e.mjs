import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import process from 'node:process';

import {
  parseCommandExecutionTerminal,
} from '../../../packages/schemas/src/commands/index.ts';
import {
  advanceProcessTerminalState,
} from '../../../src/domains/commands/features/process-control/functions/advanceProcessTerminalState.ts';
import { withOwnedProcessTree } from './harness/ownedProcessTree.mjs';

function createIdentity() {
  return {
    conversation_id: 'owner-harness-conversation',
    agent_run_id: 'owner-harness-run',
    origin_tool_call_id: 'owner-harness-shell-call',
    command_execution_id: `command_execution_${randomUUID()}`,
    owner_generation_id: `command_owner_${randomUUID()}`,
    created_at_ms: Date.now(),
  };
}

function createEndedTerminal({
  identity,
  terminationCause,
  processExit,
  treeCleanup = { status: 'not_required' },
}) {
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity,
    settled_at_ms: Date.now(),
    outcome: 'execution_ended',
    termination_cause: terminationCause,
    process_exit: processExit,
    output_drain: { status: 'complete' },
    tree_cleanup: treeCleanup,
    resource_release: { status: 'succeeded' },
  });
}

async function observeNaturalExit(exitCode) {
  const child = spawn(
    process.execPath,
    ['-e', 'process.exit(Number(process.argv[1]))', String(exitCode)],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.resume();
  child.stderr.resume();
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({
      status: 'observed',
      exit_code: code,
      signal,
    }));
  });
}

async function verifyBrandExitCodesStayNatural() {
  for (const exitCode of [124, 130]) {
    const processExit = await observeNaturalExit(exitCode);
    const terminal = createEndedTerminal({
      identity: createIdentity(),
      terminationCause: 'natural_exit',
      processExit,
    });
    assert.equal(terminal.termination_cause, 'natural_exit');
    assert.equal(terminal.process_exit.status, 'observed');
    assert.equal(terminal.process_exit.exit_code, exitCode);
  }
}

async function verifyRealTreeTerminalArbitration() {
  await withOwnedProcessTree({}, async ({ tree }) => {
    const identity = createIdentity();
    const teardown = await tree.terminate({ gracefulTimeoutMs: 100 });
    assert(teardown.closeOutcome, '整树收尾必须观察到根 child close');
    assert.equal(teardown.closeOutcome.kind, 'close');

    const timeoutTerminal = createEndedTerminal({
      identity,
      terminationCause: 'hard_timeout',
      processExit: {
        status: 'observed',
        exit_code: teardown.closeOutcome.code,
        signal: teardown.closeOutcome.signal,
      },
      treeCleanup: { status: 'succeeded' },
    });
    const accepted = advanceProcessTerminalState({
      expectedIdentity: identity,
      currentTerminal: undefined,
      candidate: timeoutTerminal,
    });
    assert.equal(accepted.status, 'accepted');

    const lateNaturalExit = createEndedTerminal({
      identity,
      terminationCause: 'natural_exit',
      processExit: {
        status: 'observed',
        exit_code: 0,
        signal: null,
      },
    });
    const ignored = advanceProcessTerminalState({
      expectedIdentity: identity,
      currentTerminal: timeoutTerminal,
      candidate: lateNaturalExit,
    });
    assert.equal(ignored.status, 'ignored');
    assert.equal(ignored.reason, 'already_terminal');
    assert.equal(ignored.terminal?.termination_cause, 'hard_timeout');
  });
}

await verifyBrandExitCodesStayNatural();
await verifyRealTreeTerminalArbitration();

console.log(
  `[shell-tool-owner-contract] ${process.platform} raw exit、整树收尾与唯一终态合同通过。`,
);
