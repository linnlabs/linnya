import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fsp, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  CommandConversationIdSchema,
  CommandExecutionIdentitySchema,
  CommandOwnerGenerationIdSchema,
  parseCommandExecutionTerminal,
  type CommandExecutionIdentity,
  type CommandExecutionTerminalV1,
  type CommandOwnerTerminationCause,
} from '../../../packages/schemas/src/commands';
import type {
  CommandExecutionRuntimeStopCause,
  PreparedCommandExecutionRuntime,
} from '../../../src/domains/commands';
import { createLocalCommandExecutionOwner } from '../../../src/app-hosts/linnya/adapters/commands/process-owner';
import { createConversationCleanupActivityPort } from '../../../src/app-hosts/linnya/application/conversation-lifecycle';
import {
  createBoundedPipeCommandOutputObservation,
} from '../../../src/infra/adapters/command-runtime/output';

const OWNER_GENERATION = CommandOwnerGenerationIdSchema.parse(
  'command_owner_218f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
);

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function createOutputObservation() {
  return createBoundedPipeCommandOutputObservation({
    maxEvents: 1_024,
    maxCharacters: 4_000,
  });
}

function createIdentity(conversationId: string): CommandExecutionIdentity {
  return CommandExecutionIdentitySchema.parse({
    conversation_id: conversationId,
    agent_run_id: 'owner-e2e-agent-run',
    origin_tool_call_id: 'owner-e2e-shell-call',
    command_execution_id: `command_execution_${randomUUID()}`,
    owner_generation_id: OWNER_GENERATION,
    created_at_ms: Date.now(),
  });
}

function createTerminal(input: {
  readonly identity: CommandExecutionIdentity;
  readonly cause: 'natural_exit' | CommandOwnerTerminationCause;
}): CommandExecutionTerminalV1 {
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity: input.identity,
    settled_at_ms: Date.now(),
    outcome: 'execution_ended',
    termination_cause: input.cause,
    process_exit: { status: 'observed', exit_code: 0, signal: null },
    output_drain: { status: 'complete' },
    tree_cleanup: input.cause === 'owner_ended'
      ? { status: 'succeeded' }
      : { status: 'not_required' },
    resource_release: { status: 'succeeded' },
  });
}

function waitForChildSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = () => {
      child.off('error', onError);
      resolve();
    };
    const onError = (error: Error) => {
      child.off('spawn', onSpawn);
      reject(error);
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

function stopChildAndWait(child: ChildProcess): Promise<{
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      child.off('error', onError);
      child.off('close', onClose);
    };
    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onClose = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ exitCode, signal });
    };
    const onError = (error: Error) => {
      finishWithError(error);
    };
    const timeout = setTimeout(() => {
      finishWithError(new Error('timed out waiting for owned setup-failure child close'));
    }, 5_000);
    child.once('error', onError);
    child.once('close', onClose);
    if (!child.kill()) {
      finishWithError(new Error('owned setup-failure child could not be stopped'));
    }
  });
}

async function expectMissing(filePath: string): Promise<void> {
  await assert.rejects(fsp.access(filePath), (error: unknown) => (
    error instanceof Error && 'code' in error && error.code === 'ENOENT'
  ));
}

async function main(): Promise<void> {
  const runRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'linnya-command-owner-e2e-中文 path-'),
  );
  let setupFailureChild: ChildProcess | undefined;
  try {
    const owner = createLocalCommandExecutionOwner({ generationId: OWNER_GENERATION });
    const activity = createConversationCleanupActivityPort({
      commands: owner,
      stopFlowAndWait: async () => {},
    });

    const deletedIdentity = createIdentity('owner-e2e-delete-first');
    const deletedReservation = owner.reserve({ identity: deletedIdentity, mode: 'pipe' });
    assert.equal(deletedReservation.status, 'reserved');
    if (deletedReservation.status !== 'reserved') throw new Error('reservation rejected');
    const deletedMarker = path.join(runRoot, 'deleted-first-started.txt');
    activity.beginStopping(deletedIdentity.conversation_id);
    await activity.stopAndWait(deletedIdentity.conversation_id);
    const deletedClaim = await owner.claimAndStart({
      binding: deletedReservation.binding,
      prepareRuntime: () => {
        writeFileSync(deletedMarker, 'must not start', 'utf8');
        throw new Error('late start callback executed');
      },
    });
    assert.equal(deletedClaim.status, 'rejected');
    await expectMissing(deletedMarker);

    const startingIdentity = createIdentity('owner-e2e-start-first');
    const startingReservation = owner.reserve({ identity: startingIdentity, mode: 'pipe' });
    assert.equal(startingReservation.status, 'reserved');
    if (startingReservation.status !== 'reserved') throw new Error('reservation rejected');
    const startEntered = createDeferred<void>();
    const startReturned = createDeferred<void>();
    const releaseStart = createDeferred<void>();
    const stopEntered = createDeferred<CommandExecutionRuntimeStopCause>();
    const terminal = createDeferred<CommandExecutionTerminalV1>();
    const startMarker = path.join(runRoot, 'start-first-started.txt');
    const stopMarker = path.join(runRoot, 'start-first-stopped.txt');
    const runtime: PreparedCommandExecutionRuntime = {
      outputObservation: createOutputObservation(),
      terminal: terminal.promise,
      async start() {
        startEntered.resolve();
        await releaseStart.promise;
        await fsp.writeFile(startMarker, 'started', 'utf8');
        startReturned.resolve();
        return { status: 'running' };
      },
      async stopAndWait(cause) {
        await fsp.writeFile(stopMarker, cause, 'utf8');
        stopEntered.resolve(cause);
        return terminal.promise;
      },
    };
    const starting = owner.claimAndStart({
      binding: startingReservation.binding,
      prepareRuntime: () => runtime,
    });
    await startEntered.promise;
    activity.beginStopping(startingIdentity.conversation_id);
    let cleanupSettled = false;
    const cleanup = activity.stopAndWait(startingIdentity.conversation_id).then(() => {
      cleanupSettled = true;
    });
    await stopEntered.promise;
    assert.equal(cleanupSettled, false);
    assert.equal(await fsp.readFile(stopMarker, 'utf8'), 'owner_ended');
    terminal.resolve(createTerminal({ identity: startingIdentity, cause: 'owner_ended' }));
    await Promise.resolve();
    assert.equal(
      cleanupSettled,
      false,
      'terminal must not release cleanup while runtime.start is still pending',
    );
    releaseStart.resolve();
    await startReturned.promise;
    assert.equal(await fsp.readFile(startMarker, 'utf8'), 'started');
    const startingResult = await starting;
    assert.equal(startingResult.status, 'terminal');
    await cleanup;

    const setupFailureIdentity = createIdentity('owner-e2e-setup-failure');
    const setupFailureReservation = owner.reserve({
      identity: setupFailureIdentity,
      mode: 'pipe',
    });
    assert.equal(setupFailureReservation.status, 'reserved');
    if (setupFailureReservation.status !== 'reserved') {
      throw new Error('setup-failure reservation rejected');
    }
    const setupFailureTerminal = createDeferred<CommandExecutionTerminalV1>();
    let setupFailureChildPid: number | undefined;
    let setupFailureStopCause: CommandExecutionRuntimeStopCause | undefined;
    const failedStart = owner.claimAndStart({
      binding: setupFailureReservation.binding,
      prepareRuntime: () => ({
        outputObservation: createOutputObservation(),
        terminal: setupFailureTerminal.promise,
        async start() {
          setupFailureChild = spawn(
            process.execPath,
            ['-e', 'setInterval(() => {}, 1000)'],
            { stdio: 'ignore', windowsHide: true },
          );
          await waitForChildSpawn(setupFailureChild);
          setupFailureChildPid = setupFailureChild.pid;
          throw new Error('simulated reader setup failure after spawn');
        },
        async stopAndWait(cause) {
          setupFailureStopCause = cause;
          if (!setupFailureChild) {
            throw new Error('setup-failure runtime lost its owned child');
          }
          const childExit = await stopChildAndWait(setupFailureChild);
          const failedTerminal = parseCommandExecutionTerminal({
            protocol_version: 1,
            kind: 'command_execution_terminal',
            identity: setupFailureIdentity,
            settled_at_ms: Date.now(),
            outcome: 'runtime_failure',
            failure: { code: 'internal_failure' },
            process_exit: {
              status: 'observed',
              exit_code: childExit.exitCode,
              signal: childExit.signal,
            },
            output_drain: { status: 'complete' },
            tree_cleanup: { status: 'succeeded' },
            resource_release: { status: 'succeeded' },
          });
          setupFailureTerminal.resolve(failedTerminal);
          return failedTerminal;
        },
      }),
    });
    await assert.rejects(failedStart, /start failed after owner handoff/u);
    assert.equal(setupFailureStopCause, 'runtime_start_failed');
    assert.equal(typeof setupFailureChildPid, 'number');
    assert.notEqual(setupFailureChildPid, process.pid);
    assert.ok(setupFailureChild);
    assert.ok(
      setupFailureChild.exitCode !== null || setupFailureChild.signalCode !== null,
      'setup-failure child must be closed before owner releases the execution',
    );
    assert.equal(owner.readActivitySnapshot().stoppingCount, 0);

    const blockedOwner = createLocalCommandExecutionOwner({ generationId: OWNER_GENERATION });
    const blockedIdentity = createIdentity('owner-e2e-tree-cleanup-failed');
    const blockedReservation = blockedOwner.reserve({
      identity: blockedIdentity,
      mode: 'pipe',
    });
    assert.equal(blockedReservation.status, 'reserved');
    if (blockedReservation.status !== 'reserved') {
      throw new Error('tree-cleanup-failed reservation rejected');
    }
    const blockedTerminal = createDeferred<CommandExecutionTerminalV1>();
    let blockedStopCount = 0;
    const blockedStart = await blockedOwner.claimAndStart({
      binding: blockedReservation.binding,
      prepareRuntime: () => ({
        outputObservation: createOutputObservation(),
        terminal: blockedTerminal.promise,
        async start() {
          return { status: 'running' };
        },
        async stopAndWait() {
          blockedStopCount += 1;
          const failed = parseCommandExecutionTerminal({
            ...createTerminal({ identity: blockedIdentity, cause: 'owner_ended' }),
            tree_cleanup: { status: 'failed', code: 'tree_cleanup_failed' },
          });
          blockedTerminal.resolve(failed);
          return failed;
        },
      }),
    });
    assert.equal(blockedStart.status, 'running');
    blockedOwner.beginConversationStop(blockedIdentity.conversation_id);
    await assert.rejects(
      blockedOwner.stopConversationAndWait(blockedIdentity.conversation_id),
      /Failed to stop 1 command execution/u,
    );
    await assert.rejects(
      blockedOwner.stopConversationAndWait(blockedIdentity.conversation_id),
      /Failed to stop 1 command execution/u,
    );
    assert.equal(blockedStopCount, 1);
    assert.equal(blockedOwner.readActivitySnapshot().stoppingCount, 1);

    const parallelA = createIdentity('owner-e2e-parallel-a');
    const parallelB = createIdentity('owner-e2e-parallel-b');
    const reservationA = owner.reserve({ identity: parallelA, mode: 'pipe' });
    const reservationB = owner.reserve({ identity: parallelB, mode: 'pipe' });
    assert.equal(reservationA.status, 'reserved');
    assert.equal(reservationB.status, 'reserved');
    if (reservationA.status !== 'reserved' || reservationB.status !== 'reserved') {
      throw new Error('parallel reservation rejected');
    }
    await activity.stopAndWait(parallelA.conversation_id);
    const terminalB = createDeferred<CommandExecutionTerminalV1>();
    const startedB = await owner.claimAndStart({
      binding: reservationB.binding,
      prepareRuntime: () => ({
        outputObservation: createOutputObservation(),
        terminal: terminalB.promise,
        async start() {
          return { status: 'running' };
        },
        stopAndWait: async () => terminalB.promise,
      }),
    });
    assert.equal(startedB.status, 'running');
    terminalB.resolve(createTerminal({ identity: parallelB, cause: 'natural_exit' }));
    if (startedB.status !== 'running') throw new Error('parallel B failed to start');
    await startedB.terminal;
    assert.equal(owner.discardUnpublishedHandle(reservationB.binding).status, 'discarded');

    for (let index = 0; index < 100; index += 1) {
      const identity = createIdentity(`owner-e2e-release-${index}`);
      const reserved = owner.reserve({ identity, mode: 'pipe' });
      assert.equal(reserved.status, 'reserved');
      if (reserved.status !== 'reserved') throw new Error('release loop reservation rejected');
      assert.equal(owner.release(reserved.binding).status, 'released');
    }
    assert.deepEqual(owner.readActivitySnapshot(), {
      generationId: OWNER_GENERATION,
      lifecycle: 'active',
      reservedCount: 0,
      startingCount: 0,
      runningCount: 0,
      stoppingCount: 0,
      pendingHandleDecisionCount: 0,
      terminalReplayCount: 0,
    });

    const oldConversationId = CommandConversationIdSchema.parse('owner-e2e-old-generation');
    const oldIdentity = createIdentity(oldConversationId);
    const oldReservation = owner.reserve({ identity: oldIdentity, mode: 'pipe' });
    assert.equal(oldReservation.status, 'reserved');
    if (oldReservation.status !== 'reserved') throw new Error('old reservation rejected');
    await owner.endAndWait();
    let oldStartCount = 0;
    const oldClaim = await owner.claimAndStart({
      binding: oldReservation.binding,
      prepareRuntime: () => {
        oldStartCount += 1;
        throw new Error('ended owner callback executed');
      },
    });
    assert.equal(oldClaim.status, 'rejected');
    assert.equal(oldStartCount, 0);
    assert.equal(owner.readActivitySnapshot().lifecycle, 'ended');

    process.stdout.write(`${JSON.stringify({
      ok: true,
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      cases: 7,
    })}\n`);
  } finally {
    if (
      setupFailureChild
      && setupFailureChild.exitCode === null
      && setupFailureChild.signalCode === null
    ) {
      await stopChildAndWait(setupFailureChild);
    }
    await fsp.rm(runRoot, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
