import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import {
  CommandExecutionIdentitySchema,
  CommandOwnerGenerationIdSchema,
  CommandProcessHandleSchema,
  ProcessOutputCursorSchema,
  parseCommandExecutionTerminal,
  parseProcessControlRequest,
  type CommandExecutionIdentity,
  type CommandExecutionTerminalV1,
  type CommandOwnerTerminationCause,
  type ProcessControlActionV1,
} from '@app/schemas/commands';
import {
  CLOSED_COMMAND_EXECUTION_INTERACTION,
  createUnavailableCommandSettledTextOutput,
  isProcessCancellationRequest,
  type CommandExecutionRuntimeStopCause,
  type ProcessCancellationRequestV1,
} from '../../../../../../domains/commands';
import {
  createBoundedPipeCommandOutputObservation,
} from '../../../../../../infra/adapters/command-runtime/output';
import { createLocalCommandExecutionOwner } from '../orchestration/createLocalCommandExecutionOwner';

const OWNER_GENERATION = CommandOwnerGenerationIdSchema.parse(
  'command_owner_418f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
);
const OTHER_GENERATION = CommandOwnerGenerationIdSchema.parse(
  'command_owner_418f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2e',
);

const unavailableSettledTextOutput = () => Promise.resolve(
  createUnavailableCommandSettledTextOutput('pipe'),
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

function createOwner() {
  return createLocalCommandExecutionOwner({
    generationId: OWNER_GENERATION,
    createProcessHandle: () => CommandProcessHandleSchema.parse(
      `command_process_${randomUUID()}`,
    ),
  });
}

function createIdentity(conversationId = 'owner-cancel-conversation'): CommandExecutionIdentity {
  return CommandExecutionIdentitySchema.parse({
    conversation_id: conversationId,
    agent_run_id: 'owner-cancel-agent-run',
    origin_tool_call_id: 'owner-cancel-shell-call',
    command_execution_id: `command_execution_${randomUUID()}`,
    owner_generation_id: OWNER_GENERATION,
    created_at_ms: 1_785_585_600_000,
  });
}

function createTerminal(input: {
  readonly identity: CommandExecutionIdentity;
  readonly cause: 'natural_exit' | CommandOwnerTerminationCause;
  readonly treeCleanup?: 'succeeded' | 'failed';
}): CommandExecutionTerminalV1 {
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity: input.identity,
    settled_at_ms: 1_785_585_601_000,
    outcome: 'execution_ended',
    termination_cause: input.cause,
    process_exit: { status: 'observed', exit_code: null, signal: 'SIGKILL' },
    output_drain: { status: 'complete' },
    tree_cleanup: input.treeCleanup === 'failed'
      ? { status: 'failed', code: 'tree_cleanup_failed' }
      : { status: 'succeeded' },
    resource_release: { status: 'succeeded' },
  });
}

function createOutputObservation() {
  return createBoundedPipeCommandOutputObservation({
    maxEvents: 1_024,
    maxCharacters: 4_000,
  });
}

function createProcessRequest(input: {
  readonly binding: ReturnType<typeof reserve>;
  readonly action: ProcessControlActionV1;
  readonly conversationId?: string;
  readonly agentRunId?: string;
  readonly generationId?: string;
}) {
  return parseProcessControlRequest({
    protocol_version: 1,
    kind: 'process_control_request',
    process_handle: input.binding.process_handle,
    scope: {
      conversation_id: input.conversationId ?? input.binding.identity.conversation_id,
      agent_run_id: input.agentRunId ?? input.binding.identity.agent_run_id,
      control_tool_call_id: `owner-cancel-call-${randomUUID()}`,
      owner_generation_id: input.generationId ?? input.binding.identity.owner_generation_id,
    },
    action: input.action,
  });
}

function createCancelRequest(input: {
  readonly binding: ReturnType<typeof reserve>;
  readonly conversationId?: string;
  readonly agentRunId?: string;
  readonly generationId?: string;
}): ProcessCancellationRequestV1 {
  const request = createProcessRequest({ ...input, action: { type: 'cancel' } });
  if (!isProcessCancellationRequest(request)) {
    throw new Error('cancel request parser returned another action');
  }
  return request;
}

function reserve(owner: ReturnType<typeof createOwner>, identity: CommandExecutionIdentity) {
  const result = owner.reserve({ identity, mode: 'pipe' });
  if (result.status !== 'reserved') throw new Error(`reservation rejected: ${result.code}`);
  return result.binding;
}

describe('local command process cancellation', () => {
  it('只取消已公开且属于当前 owner scope 的 handle，并允许取消期间继续查询输出', async () => {
    const owner = createOwner();
    const identity = createIdentity();
    const binding = reserve(owner, identity);
    const outputObservation = createOutputObservation();
    const terminal = createDeferred<CommandExecutionTerminalV1>();
    const stopEntered = createDeferred<CommandExecutionRuntimeStopCause>();
    const stopCauses: CommandExecutionRuntimeStopCause[] = [];
    const started = await owner.claimAndStart({
      binding,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation,
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: terminal.promise,
        async start() {
          return { status: 'running', startedAtMs: 200 };
        },
        async stopAndWait(cause) {
          stopCauses.push(cause);
          stopEntered.resolve(cause);
          return terminal.promise;
        },
      }),
    });
    expect(started.status).toBe('running');

    await expect(owner.cancelAndWait(createCancelRequest({ binding }))).resolves.toEqual({
      status: 'rejected',
      code: 'unknown_handle',
    });
    expect(owner.publishHandle(binding)).toEqual({ status: 'published', binding });
    outputObservation.accept({
      channel: 'stdout',
      stableText: 'before cancel\n',
      currentLogicalLines: {
        stdout: { text: '', omittedCharacters: 0 },
        stderr: { text: '', omittedCharacters: 0 },
      },
    });

    const cancelling = owner.cancelAndWait(createCancelRequest({ binding }));
    await expect(stopEntered.promise).resolves.toBe('user_cancelled');
    await expect(owner.queryOutput(createProcessRequest({
      binding,
      action: { type: 'poll', cursor: ProcessOutputCursorSchema.parse(0) },
    }))).resolves.toMatchObject({
      status: 'running',
      observation: { stdout: 'before cancel\n' },
    });

    outputObservation.close({ trailingStableText: { stdout: '', stderr: '' } });
    const cancelledTerminal = createTerminal({ identity, cause: 'user_cancelled' });
    terminal.resolve(cancelledTerminal);
    await expect(cancelling).resolves.toEqual({
      status: 'terminal',
      processHandle: binding.process_handle,
      startedAtMs: 200,
      terminal: cancelledTerminal,
      settledTextOutput: createUnavailableCommandSettledTextOutput('pipe'),
    });
    expect(stopCauses).toEqual(['user_cancelled']);
    expect(owner.readActivitySnapshot()).toMatchObject({
      runningCount: 0,
      stoppingCount: 0,
      terminalReplayCount: 1,
    });
    await expect(owner.queryOutput(createProcessRequest({
      binding,
      action: { type: 'poll', cursor: ProcessOutputCursorSchema.parse(0) },
    }))).resolves.toMatchObject({
      status: 'terminal',
      terminal: { termination_cause: 'user_cancelled' },
    });
    await expect(owner.cancelAndWait(createCancelRequest({ binding }))).resolves.toEqual({
      status: 'rejected',
      code: 'incompatible_state',
    });
  });

  it('同一 handle 的并发取消只调用一次平台停止，并向所有调用者返回同一终态', async () => {
    const owner = createOwner();
    const identity = createIdentity('owner-cancel-concurrent');
    const binding = reserve(owner, identity);
    const terminal = createDeferred<CommandExecutionTerminalV1>();
    let stopCount = 0;
    const started = await owner.claimAndStart({
      binding,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation: createOutputObservation(),
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: terminal.promise,
        async start() {
          return { status: 'running', startedAtMs: 200 };
        },
        async stopAndWait() {
          stopCount += 1;
          return terminal.promise;
        },
      }),
    });
    expect(started.status).toBe('running');
    expect(owner.publishHandle(binding).status).toBe('published');

    const first = owner.cancelAndWait(createCancelRequest({ binding }));
    const second = owner.cancelAndWait(createCancelRequest({ binding }));
    expect(stopCount).toBe(0);
    await Promise.resolve();
    expect(stopCount).toBe(1);
    const cancelledTerminal = createTerminal({ identity, cause: 'user_cancelled' });
    terminal.resolve(cancelledTerminal);
    const results = await Promise.all([first, second]);
    expect(results).toEqual([
      {
        status: 'terminal',
        processHandle: binding.process_handle,
        startedAtMs: 200,
        terminal: cancelledTerminal,
        settledTextOutput: createUnavailableCommandSettledTextOutput('pipe'),
      },
      {
        status: 'terminal',
        processHandle: binding.process_handle,
        startedAtMs: 200,
        terminal: cancelledTerminal,
        settledTextOutput: createUnavailableCommandSettledTextOutput('pipe'),
      },
    ]);
  });

  it('隐藏或跨 scope handle 不可取消，owner 结束后旧请求也不能触发平台停止', async () => {
    const owner = createOwner();
    const identity = createIdentity('owner-cancel-scope');
    const binding = reserve(owner, identity);
    const terminal = createDeferred<CommandExecutionTerminalV1>();
    let stopCount = 0;
    const started = await owner.claimAndStart({
      binding,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation: createOutputObservation(),
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: terminal.promise,
        async start() {
          return { status: 'running', startedAtMs: 200 };
        },
        async stopAndWait(cause) {
          stopCount += 1;
          if (cause === 'runtime_start_failed') {
            throw new Error('running cancellation fixture received a start-failure cause');
          }
          const ended = createTerminal({ identity, cause });
          terminal.resolve(ended);
          return ended;
        },
      }),
    });
    expect(started.status).toBe('running');
    expect(owner.publishHandle(binding).status).toBe('published');

    for (const request of [
      createCancelRequest({ binding, conversationId: 'other-conversation' }),
      createCancelRequest({ binding, agentRunId: 'other-agent-run' }),
    ]) {
      await expect(owner.cancelAndWait(request)).resolves.toEqual({
        status: 'rejected',
        code: 'unknown_handle',
      });
    }
    await expect(owner.cancelAndWait(createCancelRequest({
      binding,
      generationId: OTHER_GENERATION,
    }))).resolves.toEqual({ status: 'rejected', code: 'scope_mismatch' });
    expect(stopCount).toBe(0);

    const ending = owner.endAndWait();
    await expect(owner.cancelAndWait(createCancelRequest({ binding }))).resolves.toEqual({
      status: 'rejected',
      code: 'owner_ending',
    });
    await ending;
    await expect(owner.cancelAndWait(createCancelRequest({ binding }))).resolves.toEqual({
      status: 'rejected',
      code: 'owner_ended',
    });
    expect(stopCount).toBe(1);
  });

  it('平台无法证明整树清理时如实返回失败终态，并继续阻断对话删除', async () => {
    const owner = createOwner();
    const identity = createIdentity('owner-cancel-cleanup-failed');
    const binding = reserve(owner, identity);
    const terminal = createDeferred<CommandExecutionTerminalV1>();
    const failedTerminal = createTerminal({
      identity,
      cause: 'user_cancelled',
      treeCleanup: 'failed',
    });
    const started = await owner.claimAndStart({
      binding,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation: createOutputObservation(),
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: terminal.promise,
        async start() {
          return { status: 'running', startedAtMs: 200 };
        },
        async stopAndWait() {
          terminal.resolve(failedTerminal);
          return failedTerminal;
        },
      }),
    });
    expect(started.status).toBe('running');
    expect(owner.publishHandle(binding).status).toBe('published');

    await expect(owner.cancelAndWait(createCancelRequest({ binding }))).resolves.toEqual({
      status: 'terminal',
      processHandle: binding.process_handle,
      startedAtMs: 200,
      terminal: failedTerminal,
      settledTextOutput: createUnavailableCommandSettledTextOutput('pipe'),
    });
    expect(owner.readActivitySnapshot()).toMatchObject({
      runningCount: 0,
      stoppingCount: 1,
      terminalReplayCount: 0,
    });
    await expect(owner.stopConversationAndWait(identity.conversation_id)).rejects.toThrow(
      /Failed to stop 1 command execution/u,
    );
    expect(owner.readActivitySnapshot().stoppingCount).toBe(1);
  });
});
