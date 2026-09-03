import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CommandExecutionIdentitySchema,
  CommandOwnerGenerationIdSchema,
  CommandProcessHandleSchema,
  ProcessOutputCursorSchema,
  parseCommandExecutionTerminal,
  parseCommandExecutionOwnerBinding,
  parseProcessControlRequest,
  type CommandExecutionIdentity,
  type CommandExecutionOwnerBindingV1,
  type CommandExecutionTerminalV1,
  type ProcessControlActionV1,
} from '@app/schemas/commands';
import {
  CLOSED_COMMAND_EXECUTION_INTERACTION,
  createUnavailableCommandSettledTextOutput,
} from '../../../../../../domains/commands';
import {
  createBoundedPipeCommandOutputObservation,
} from '../../../../../../infra/adapters/command-runtime/output';
import { createLocalCommandExecutionOwner } from '../orchestration/createLocalCommandExecutionOwner';

const OWNER_GENERATION = CommandOwnerGenerationIdSchema.parse(
  'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
);
const OTHER_GENERATION = CommandOwnerGenerationIdSchema.parse(
  'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2e',
);

const unavailableSettledTextOutput = () => Promise.resolve(
  createUnavailableCommandSettledTextOutput('pipe'),
);

afterEach(() => vi.useRealTimers());

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

function createIdentity(conversationId = 'owner-process-conversation'): CommandExecutionIdentity {
  return CommandExecutionIdentitySchema.parse({
    conversation_id: conversationId,
    agent_run_id: 'owner-process-agent-run',
    origin_tool_call_id: 'owner-process-shell-call',
    command_execution_id: `command_execution_${randomUUID()}`,
    owner_generation_id: OWNER_GENERATION,
    created_at_ms: 1_785_585_600_000,
  });
}

function createTerminal(identity: CommandExecutionIdentity): CommandExecutionTerminalV1 {
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity,
    settled_at_ms: 1_785_585_601_000,
    outcome: 'execution_ended',
    termination_cause: 'natural_exit',
    process_exit: { status: 'observed', exit_code: 0, signal: null },
    output_drain: { status: 'complete' },
    tree_cleanup: { status: 'not_required' },
    resource_release: { status: 'succeeded' },
  });
}

function createOwner(input: { readonly now?: () => number } = {}) {
  return createLocalCommandExecutionOwner({
    generationId: OWNER_GENERATION,
    createProcessHandle: () => CommandProcessHandleSchema.parse(
      `command_process_${randomUUID()}`,
    ),
    ...(input.now ? { now: input.now } : {}),
  });
}

function createOutputObservation() {
  return createBoundedPipeCommandOutputObservation({
    maxEvents: 1_024,
    maxCharacters: 4_000,
  });
}

function reserve(
  owner: ReturnType<typeof createOwner>,
  identity: CommandExecutionIdentity,
): CommandExecutionOwnerBindingV1 {
  const result = owner.reserve({ identity, mode: 'pipe' });
  expect(result.status).toBe('reserved');
  if (result.status !== 'reserved') throw new Error('reservation rejected');
  return result.binding;
}

function createProcessRequest(input: {
  readonly binding: CommandExecutionOwnerBindingV1;
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
      control_tool_call_id: `owner-process-call-${randomUUID()}`,
      owner_generation_id: input.generationId
        ?? input.binding.identity.owner_generation_id,
    },
    action: input.action,
  });
}

function acceptObservedText(
  observation: ReturnType<typeof createOutputObservation>,
  channel: 'stdout' | 'stderr',
  stableText: string,
): void {
  observation.accept({
    channel,
    stableText,
    currentLogicalLines: {
      stdout: { text: '', omittedCharacters: 0 },
      stderr: { text: '', omittedCharacters: 0 },
    },
  });
}

async function resolvePromptly<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('operation did not resolve promptly')), 100);
    void promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

describe('local command process observation', () => {
  it('handle 公开后按 owner scope 非消费式 poll/wait，并在自身期限内等待可信终态', async () => {
    const owner = createOwner();
    const identity = createIdentity();
    const binding = reserve(owner, identity);
    const outputObservation = createOutputObservation();
    const terminal = createDeferred<CommandExecutionTerminalV1>();
    const settledTextOutput = Promise.resolve({
      mode: 'pipe' as const,
      stdout: {
        status: 'published' as const,
        completeness: 'complete' as const,
        blobId: '0123456789abcdef',
        persistedCharacters: 6,
        persistedLines: 2,
      },
      stderr: { status: 'not_created' as const, reason: 'empty' as const },
    });
    const started = await owner.claimAndStart({
      binding,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation,
        settledTextOutput,
        terminal: terminal.promise,
        async start() {
          return { status: 'running', startedAtMs: 200 };
        },
        async stopAndWait() {
          return terminal.promise;
        },
      }),
    });
    expect(started.status).toBe('running');

    const cursorZero = ProcessOutputCursorSchema.parse(0);
    const initialPoll = createProcessRequest({
      binding,
      action: { type: 'poll', cursor: cursorZero },
    });
    await expect(owner.queryOutput(initialPoll)).resolves.toEqual({
      status: 'rejected',
      code: 'unknown_handle',
    });
    expect(owner.publishHandle(binding)).toEqual({ status: 'published', binding });

    acceptObservedText(outputObservation, 'stdout', 'first\n');
    const first = await owner.queryOutput(initialPoll);
    expect(first).toMatchObject({
      status: 'running',
      startedAtMs: 200,
      observation: { stdout: 'first\n', stderr: '', outputPhase: 'open' },
    });
    await expect(owner.queryOutput(initialPoll)).resolves.toEqual(first);
    if (first.status !== 'running') throw new Error('expected running process output');

    const waitForSecond = owner.queryOutput(createProcessRequest({
      binding,
      action: {
        type: 'wait',
        cursor: first.observation.nextCursor,
        wait_timeout_ms: 100,
      },
    }));
    acceptObservedText(outputObservation, 'stderr', 'second\n');
    await expect(waitForSecond).resolves.toMatchObject({
      status: 'running',
      observation: { stdout: '', stderr: 'second\n' },
    });

    await expect(owner.queryOutput(createProcessRequest({
      binding,
      action: { type: 'poll', cursor: ProcessOutputCursorSchema.parse(999) },
    }))).resolves.toEqual({ status: 'rejected', code: 'invalid_cursor' });
    await expect(owner.queryOutput(createProcessRequest({
      binding,
      action: { type: 'cancel' },
    }))).resolves.toEqual({ status: 'rejected', code: 'action_not_supported' });
    for (const request of [
      createProcessRequest({
        binding,
        conversationId: 'other-conversation',
        action: { type: 'poll', cursor: cursorZero },
      }),
      createProcessRequest({
        binding,
        agentRunId: 'other-agent-run',
        action: { type: 'poll', cursor: cursorZero },
      }),
    ]) {
      await expect(owner.queryOutput(request)).resolves.toEqual({
        status: 'rejected',
        code: 'unknown_handle',
      });
    }
    await expect(owner.queryOutput(createProcessRequest({
      binding,
      generationId: OTHER_GENERATION,
      action: { type: 'poll', cursor: cursorZero },
    }))).resolves.toEqual({ status: 'rejected', code: 'scope_mismatch' });

    outputObservation.close({ trailingStableText: { stdout: '', stderr: '' } });
    await expect(resolvePromptly(owner.queryOutput(createProcessRequest({
      binding,
      action: { type: 'poll', cursor: first.observation.nextCursor },
    })))).resolves.toMatchObject({
      status: 'running',
      observation: { outputPhase: 'closed' },
    });
    const waitStartedAt = Date.now();
    await expect(owner.queryOutput(createProcessRequest({
      binding,
      action: {
        type: 'wait',
        cursor: first.observation.nextCursor,
        wait_timeout_ms: 20,
      },
    }))).resolves.toMatchObject({ status: 'running' });
    expect(Date.now() - waitStartedAt).toBeGreaterThanOrEqual(10);

    terminal.resolve(createTerminal(identity));
    if (started.status !== 'running') throw new Error('runtime did not start');
    await started.terminal;
    const terminalResult = await owner.queryOutput(initialPoll);
    expect(terminalResult).toMatchObject({
      status: 'terminal',
      startedAtMs: 200,
      terminal: { termination_cause: 'natural_exit' },
      settledTextOutput: {
        mode: 'pipe',
        stdout: { status: 'published', blobId: '0123456789abcdef' },
      },
    });
    await expect(owner.queryOutput(initialPoll)).resolves.toEqual(terminalResult);
  });

  it('终态与 handle 发布竞争时保留决议记录，公开或丢弃后结果唯一', async () => {
    const owner = createOwner();
    const publishedIdentity = createIdentity();
    const publishedBinding = reserve(owner, publishedIdentity);
    const publishedObservation = createOutputObservation();
    const publishedTerminal = createDeferred<CommandExecutionTerminalV1>();
    const publishedStart = await owner.claimAndStart({
      binding: publishedBinding,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation: publishedObservation,
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: publishedTerminal.promise,
        async start() {
          return { status: 'running', startedAtMs: 200 };
        },
        async stopAndWait() {
          return publishedTerminal.promise;
        },
      }),
    });
    if (publishedStart.status !== 'running') throw new Error('runtime did not start');
    publishedObservation.close({ trailingStableText: { stdout: 'final\n', stderr: '' } });
    publishedTerminal.resolve(createTerminal(publishedIdentity));
    await publishedStart.terminal;
    expect(owner.readActivitySnapshot()).toMatchObject({
      pendingHandleDecisionCount: 1,
      terminalReplayCount: 0,
    });
    const wrongBinding = parseCommandExecutionOwnerBinding({
      ...publishedBinding,
      process_handle: `command_process_${randomUUID()}`,
    });
    expect(owner.publishHandle(wrongBinding)).toEqual({
      status: 'rejected',
      code: 'scope_mismatch',
    });
    expect(owner.readActivitySnapshot().pendingHandleDecisionCount).toBe(1);
    expect(owner.publishHandle(publishedBinding)).toEqual({
      status: 'published',
      binding: publishedBinding,
    });
    await expect(owner.queryOutput(createProcessRequest({
      binding: publishedBinding,
      action: { type: 'poll', cursor: ProcessOutputCursorSchema.parse(0) },
    }))).resolves.toMatchObject({
      status: 'terminal',
      observation: { stdout: 'final\n', outputPhase: 'closed' },
    });

    const discardedIdentity = createIdentity();
    const discardedBinding = reserve(owner, discardedIdentity);
    const discardedObservation = createOutputObservation();
    const discardedTerminal = createDeferred<CommandExecutionTerminalV1>();
    const discardedStart = await owner.claimAndStart({
      binding: discardedBinding,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation: discardedObservation,
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: discardedTerminal.promise,
        async start() {
          return { status: 'running', startedAtMs: 200 };
        },
        async stopAndWait() {
          return discardedTerminal.promise;
        },
      }),
    });
    if (discardedStart.status !== 'running') throw new Error('runtime did not start');
    discardedObservation.close({ trailingStableText: { stdout: '', stderr: '' } });
    discardedTerminal.resolve(createTerminal(discardedIdentity));
    await discardedStart.terminal;
    expect(owner.discardUnpublishedHandle(discardedBinding)).toEqual({ status: 'discarded' });
    await expect(owner.queryOutput(createProcessRequest({
      binding: discardedBinding,
      action: { type: 'poll', cursor: ProcessOutputCursorSchema.parse(0) },
    }))).resolves.toEqual({ status: 'rejected', code: 'unknown_handle' });
  });

  it('完整终态 replay 最多保留 64 条，被容量淘汰的近期 handle 明确过期', async () => {
    const owner = createOwner();
    const bindings: CommandExecutionOwnerBindingV1[] = [];
    for (let index = 0; index < 129; index += 1) {
      const identity = createIdentity(`replay-conversation-${index}`);
      const binding = reserve(owner, identity);
      const outputObservation = createOutputObservation();
      const terminal = createDeferred<CommandExecutionTerminalV1>();
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
          async stopAndWait() {
            return terminal.promise;
          },
        }),
      });
      if (started.status !== 'running') throw new Error('runtime did not start');
      expect(owner.publishHandle(binding).status).toBe('published');
      outputObservation.close({ trailingStableText: { stdout: `${index}\n`, stderr: '' } });
      terminal.resolve(createTerminal(identity));
      await started.terminal;
      bindings.push(binding);
    }
    expect(owner.readActivitySnapshot()).toMatchObject({
      pendingHandleDecisionCount: 0,
      terminalReplayCount: 64,
      expiredHandleCount: 64,
    });
    const firstBinding = bindings[0];
    const recentlyExpiredBinding = bindings[64];
    const lastBinding = bindings[128];
    if (!firstBinding || !recentlyExpiredBinding || !lastBinding) {
      throw new Error('missing replay binding');
    }
    await expect(owner.queryOutput(createProcessRequest({
      binding: firstBinding,
      action: { type: 'poll', cursor: ProcessOutputCursorSchema.parse(0) },
    }))).resolves.toEqual({ status: 'rejected', code: 'unknown_handle' });
    await expect(owner.queryOutput(createProcessRequest({
      binding: recentlyExpiredBinding,
      action: { type: 'poll', cursor: ProcessOutputCursorSchema.parse(0) },
    }))).resolves.toEqual({ status: 'rejected', code: 'handle_expired' });
    await expect(owner.queryOutput(createProcessRequest({
      binding: recentlyExpiredBinding,
      conversationId: 'other-conversation',
      action: { type: 'poll', cursor: ProcessOutputCursorSchema.parse(0) },
    }))).resolves.toEqual({ status: 'rejected', code: 'unknown_handle' });
    await expect(owner.queryOutput(createProcessRequest({
      binding: lastBinding,
      action: { type: 'poll', cursor: ProcessOutputCursorSchema.parse(0) },
    }))).resolves.toMatchObject({ status: 'terminal' });
    owner.forgetDeletedConversation(recentlyExpiredBinding.identity.conversation_id);
    await expect(owner.queryOutput(createProcessRequest({
      binding: recentlyExpiredBinding,
      action: { type: 'poll', cursor: ProcessOutputCursorSchema.parse(0) },
    }))).resolves.toEqual({ status: 'rejected', code: 'unknown_handle' });
    expect(owner.readActivitySnapshot()).toMatchObject({
      terminalReplayCount: 64,
      expiredHandleCount: 63,
    });
    await owner.endAndWait();
    await expect(owner.queryOutput(createProcessRequest({
      binding: lastBinding,
      action: { type: 'poll', cursor: ProcessOutputCursorSchema.parse(0) },
    }))).resolves.toEqual({ status: 'rejected', code: 'owner_ended' });
  });

  it('完整终态 replay 最长保留 30 分钟，过期标记本身也会有界失效', async () => {
    vi.useFakeTimers();
    let currentTimeMs = 10_000;
    const owner = createOwner({ now: () => currentTimeMs });
    const identity = createIdentity('replay-ttl-conversation');
    const binding = reserve(owner, identity);
    const outputObservation = createOutputObservation();
    const terminal = createDeferred<CommandExecutionTerminalV1>();
    const started = await owner.claimAndStart({
      binding,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation,
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: terminal.promise,
        async start() {
          return { status: 'running', startedAtMs: currentTimeMs };
        },
        async stopAndWait() {
          return terminal.promise;
        },
      }),
    });
    if (started.status !== 'running') throw new Error('runtime did not start');
    expect(owner.publishHandle(binding).status).toBe('published');
    outputObservation.close({ trailingStableText: { stdout: 'done\n', stderr: '' } });
    terminal.resolve(createTerminal(identity));
    await started.terminal;
    expect(vi.getTimerCount()).toBe(1);

    currentTimeMs += 30 * 60 * 1_000 - 1;
    await vi.advanceTimersByTimeAsync(30 * 60 * 1_000 - 1);
    await expect(owner.queryOutput(createProcessRequest({
      binding,
      action: { type: 'poll', cursor: ProcessOutputCursorSchema.parse(0) },
    }))).resolves.toMatchObject({ status: 'terminal' });

    currentTimeMs += 1;
    await vi.advanceTimersByTimeAsync(1);
    await expect(owner.queryOutput(createProcessRequest({
      binding,
      action: { type: 'poll', cursor: ProcessOutputCursorSchema.parse(0) },
    }))).resolves.toEqual({ status: 'rejected', code: 'handle_expired' });
    expect(owner.readActivitySnapshot()).toMatchObject({
      terminalReplayCount: 0,
      expiredHandleCount: 1,
    });

    currentTimeMs += 30 * 60 * 1_000;
    await vi.advanceTimersByTimeAsync(30 * 60 * 1_000);
    await expect(owner.queryOutput(createProcessRequest({
      binding,
      action: { type: 'poll', cursor: ProcessOutputCursorSchema.parse(0) },
    }))).resolves.toEqual({ status: 'rejected', code: 'unknown_handle' });
    expect(vi.getTimerCount()).toBe(0);
    await owner.endAndWait();
  });
});
