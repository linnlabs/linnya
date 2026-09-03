import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import {
  CommandExecutionIdentitySchema,
  CommandOwnerGenerationIdSchema,
  CommandProcessHandleSchema,
  parseCommandExecutionTerminal,
  parseProcessControlRequest,
  type CommandExecutionIdentity,
  type CommandExecutionOwnerBindingV1,
  type CommandExecutionTerminalV1,
  type ProcessControlActionV1,
} from '@app/schemas/commands';
import {
  CLOSED_COMMAND_EXECUTION_INTERACTION,
  createUnavailableCommandSettledTextOutput,
  isProcessCancellationRequest,
  isProcessInteractionRequest,
  type CommandExecutionInteractionCapability,
  type CommandExecutionRuntimeStopCause,
  type ProcessInteractionRequestV1,
} from '../../../../../../domains/commands';
import {
  createBoundedPipeCommandOutputObservation,
} from '../../../../../../infra/adapters/command-runtime/output';
import { createLocalCommandExecutionOwner } from '../orchestration/createLocalCommandExecutionOwner';

const OWNER_GENERATION = CommandOwnerGenerationIdSchema.parse(
  'command_owner_518f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
);

const unavailableSettledTextOutput = () => Promise.resolve(
  createUnavailableCommandSettledTextOutput('pipe'),
);

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

interface StartedProcess {
  readonly binding: CommandExecutionOwnerBindingV1;
  readonly identity: CommandExecutionIdentity;
  readonly terminal: Deferred<CommandExecutionTerminalV1>;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (error: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createOwner() {
  return createLocalCommandExecutionOwner({
    generationId: OWNER_GENERATION,
    createProcessHandle: () => CommandProcessHandleSchema.parse(
      `command_process_${randomUUID()}`,
    ),
  });
}

function createIdentity(conversationId: string): CommandExecutionIdentity {
  return CommandExecutionIdentitySchema.parse({
    conversation_id: conversationId,
    agent_run_id: 'owner-interaction-agent-run',
    origin_tool_call_id: 'owner-interaction-shell-call',
    command_execution_id: `command_execution_${randomUUID()}`,
    owner_generation_id: OWNER_GENERATION,
    created_at_ms: 1_785_585_600_000,
  });
}

function createTerminal(
  identity: CommandExecutionIdentity,
  cause: 'natural_exit' | 'user_cancelled' | 'owner_ended' = 'natural_exit',
): CommandExecutionTerminalV1 {
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity,
    settled_at_ms: 1_785_585_601_000,
    outcome: 'execution_ended',
    termination_cause: cause,
    process_exit: {
      status: 'observed',
      exit_code: cause === 'natural_exit' ? 0 : null,
      signal: cause === 'natural_exit' ? null : 'SIGTERM',
    },
    output_drain: { status: 'complete' },
    tree_cleanup: cause === 'natural_exit' ? { status: 'not_required' } : { status: 'succeeded' },
    resource_release: { status: 'succeeded' },
  });
}

function createRequest(input: {
  readonly binding: CommandExecutionOwnerBindingV1;
  readonly action: ProcessControlActionV1;
  readonly conversationId?: string;
}): ProcessInteractionRequestV1 {
  const request = parseProcessControlRequest({
    protocol_version: 1,
    kind: 'process_control_request',
    process_handle: input.binding.process_handle,
    scope: {
      conversation_id: input.conversationId ?? input.binding.identity.conversation_id,
      agent_run_id: input.binding.identity.agent_run_id,
      control_tool_call_id: `owner-interaction-call-${randomUUID()}`,
      owner_generation_id: input.binding.identity.owner_generation_id,
    },
    action: input.action,
  });
  if (!isProcessInteractionRequest(request)) {
    throw new Error('interaction request parser returned another action');
  }
  return request;
}

async function startProcess(input: {
  readonly owner: ReturnType<typeof createOwner>;
  readonly conversationId: string;
  readonly mode: 'pipe' | 'pty';
  readonly interaction: CommandExecutionInteractionCapability;
  readonly onStop?: (cause: CommandExecutionRuntimeStopCause) => void;
  readonly publish?: boolean;
}): Promise<StartedProcess> {
  const identity = createIdentity(input.conversationId);
  const reserved = input.owner.reserve({ identity, mode: input.mode });
  if (reserved.status !== 'reserved') throw new Error(`reservation rejected: ${reserved.code}`);
  const terminal = createDeferred<CommandExecutionTerminalV1>();
  const started = await input.owner.claimAndStart({
    binding: reserved.binding,
    prepareRuntime: () => ({
      interaction: input.interaction,
      outputObservation: createBoundedPipeCommandOutputObservation({
        maxEvents: 128,
        maxCharacters: 4_000,
      }),
      settledTextOutput: unavailableSettledTextOutput(),
      terminal: terminal.promise,
      async start() {
        return { status: 'running', startedAtMs: 200 };
      },
      async stopAndWait(cause) {
        input.onStop?.(cause);
        const ended = createTerminal(
          identity,
          cause === 'owner_ended' ? 'owner_ended' : 'user_cancelled',
        );
        terminal.resolve(ended);
        return ended;
      },
    }),
  });
  if (started.status !== 'running') throw new Error(`runtime did not start: ${started.status}`);
  if (input.publish !== false) {
    const published = input.owner.publishHandle(reserved.binding);
    if (published.status !== 'published') throw new Error(`handle not published: ${published.code}`);
  }
  return { binding: reserved.binding, identity, terminal };
}

function createNoopPtyInteraction(): Extract<CommandExecutionInteractionCapability, { kind: 'pty' }> {
  return {
    kind: 'pty',
    write: async () => {},
    submit: async () => {},
    eof: async () => {},
    resize: async () => {},
  };
}

describe('local command process interaction', () => {
  it('用户保护输入只进入活动 PTY，并与 Agent 输入共享原有串行门', async () => {
    const owner = createOwner();
    const agentWrite = createDeferred<void>();
    const calls: string[] = [];
    const process = await startProcess({
      owner,
      conversationId: 'protected-input-serial',
      mode: 'pty',
      interaction: {
        ...createNoopPtyInteraction(),
        async write(input) {
          calls.push(`agent:${input}:start`);
          await agentWrite.promise;
          calls.push(`agent:${input}:end`);
        },
        async submit(input) {
          calls.push(`user:${input}`);
        },
      },
    });

    const ordinary = owner.controlInteraction(createRequest({
      binding: process.binding,
      action: { type: 'write', input: 'ordinary' },
    }));
    const protectedInput = owner.submitProtectedInput({
      binding: process.binding,
      input: 'secret-value',
    });
    await Promise.resolve();
    expect(calls).toEqual(['agent:ordinary:start']);

    agentWrite.resolve();
    await expect(ordinary).resolves.toMatchObject({ status: 'accepted' });
    await expect(protectedInput).resolves.toEqual({ status: 'accepted' });
    expect(calls).toEqual([
      'agent:ordinary:start',
      'agent:ordinary:end',
      'user:secret-value',
    ]);
  });

  it('保护输入拒绝 pipe、超限值和已经结束的 binding，且不触碰原生输入', async () => {
    const owner = createOwner();
    const pipe = await startProcess({
      owner,
      conversationId: 'protected-input-pipe',
      mode: 'pipe',
      interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
    });
    await expect(owner.submitProtectedInput({
      binding: pipe.binding,
      input: 'secret',
    })).resolves.toEqual({ status: 'rejected', code: 'action_not_supported' });

    let submitCount = 0;
    const pty = await startProcess({
      owner,
      conversationId: 'protected-input-limits',
      mode: 'pty',
      interaction: {
        ...createNoopPtyInteraction(),
        async submit() { submitCount += 1; },
      },
    });
    await expect(owner.submitProtectedInput({
      binding: pty.binding,
      input: 'x'.repeat((64 * 1_024) + 1),
    })).resolves.toEqual({ status: 'rejected', code: 'input_budget_exceeded' });
    expect(submitCount).toBe(0);

    pty.terminal.resolve(createTerminal(pty.identity));
    await Promise.resolve();
    await expect(owner.submitProtectedInput({
      binding: pty.binding,
      input: 'late-secret',
    })).resolves.toEqual({ status: 'rejected', code: 'incompatible_state' });
    expect(submitCount).toBe(0);
  });

  it('普通 pipe 从启动起明确关闭 stdin，并单独拒绝 resize', async () => {
    const owner = createOwner();
    const process = await startProcess({
      owner,
      conversationId: 'interaction-closed-pipe',
      mode: 'pipe',
      interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
    });

    for (const action of [
      { type: 'write', input: 'answer' },
      { type: 'submit', input: '' },
      { type: 'eof' },
    ] satisfies ProcessControlActionV1[]) {
      await expect(owner.controlInteraction(createRequest({
        binding: process.binding,
        action,
      }))).resolves.toEqual({ status: 'rejected', code: 'stdin_closed' });
    }
    await expect(owner.controlInteraction(createRequest({
      binding: process.binding,
      action: { type: 'resize', columns: 120, rows: 30 },
    }))).resolves.toEqual({ status: 'rejected', code: 'action_not_supported' });
  });

  it('同一 handle 严格串行交互，而不同 handle 不共享队列', async () => {
    const owner = createOwner();
    const firstWrite = createDeferred<void>();
    const secondWrite = createDeferred<void>();
    const calls: string[] = [];
    const first = await startProcess({
      owner,
      conversationId: 'interaction-serial-a',
      mode: 'pty',
      interaction: {
        ...createNoopPtyInteraction(),
        async write() {
          calls.push('a:write:start');
          await firstWrite.promise;
          calls.push('a:write:end');
        },
        async resize() {
          calls.push('a:resize');
        },
      },
    });
    const second = await startProcess({
      owner,
      conversationId: 'interaction-serial-b',
      mode: 'pty',
      interaction: {
        ...createNoopPtyInteraction(),
        async write() {
          calls.push('b:write:start');
          await secondWrite.promise;
          calls.push('b:write:end');
        },
      },
    });

    const firstOperation = owner.controlInteraction(createRequest({
      binding: first.binding,
      action: { type: 'write', input: 'first' },
    }));
    const queuedResize = owner.controlInteraction(createRequest({
      binding: first.binding,
      action: { type: 'resize', columns: 100, rows: 40 },
    }));
    const otherOperation = owner.controlInteraction(createRequest({
      binding: second.binding,
      action: { type: 'write', input: 'second' },
    }));
    await Promise.resolve();
    expect(calls).toEqual(['a:write:start', 'b:write:start']);

    secondWrite.resolve();
    await expect(otherOperation).resolves.toMatchObject({ status: 'accepted' });
    expect(calls).not.toContain('a:resize');
    firstWrite.resolve();
    await expect(firstOperation).resolves.toMatchObject({ status: 'accepted' });
    await expect(queuedResize).resolves.toMatchObject({ status: 'accepted' });
    expect(calls).toEqual([
      'a:write:start',
      'b:write:start',
      'b:write:end',
      'a:write:end',
      'a:resize',
    ]);
  });

  it('EOF 只在底层成功后关闭输入，关闭后仍允许 resize', async () => {
    const owner = createOwner();
    const calls: string[] = [];
    let eofShouldFail = true;
    const process = await startProcess({
      owner,
      conversationId: 'interaction-eof',
      mode: 'pty',
      interaction: {
        ...createNoopPtyInteraction(),
        async write(input) {
          calls.push(`write:${input}`);
        },
        async submit(input) {
          calls.push(`submit:${input}`);
        },
        async eof() {
          calls.push('eof');
          if (eofShouldFail) throw new Error('native eof failed');
        },
        async resize({ columns, rows }) {
          calls.push(`resize:${columns}x${rows}`);
        },
      },
    });

    await expect(owner.controlInteraction(createRequest({
      binding: process.binding,
      action: { type: 'eof' },
    }))).resolves.toEqual({ status: 'rejected', code: 'interaction_failed' });
    await expect(owner.controlInteraction(createRequest({
      binding: process.binding,
      action: { type: 'write', input: 'still-open' },
    }))).resolves.toMatchObject({ status: 'accepted' });
    await expect(owner.controlInteraction(createRequest({
      binding: process.binding,
      action: { type: 'submit', input: 'confirm' },
    }))).resolves.toMatchObject({ status: 'accepted' });

    eofShouldFail = false;
    await expect(owner.controlInteraction(createRequest({
      binding: process.binding,
      action: { type: 'eof' },
    }))).resolves.toMatchObject({ status: 'accepted' });
    for (const action of [
      { type: 'write', input: 'closed' },
      { type: 'submit', input: '' },
      { type: 'eof' },
    ] satisfies ProcessControlActionV1[]) {
      await expect(owner.controlInteraction(createRequest({
        binding: process.binding,
        action,
      }))).resolves.toEqual({ status: 'rejected', code: 'stdin_closed' });
    }
    await expect(owner.controlInteraction(createRequest({
      binding: process.binding,
      action: { type: 'resize', columns: 90, rows: 24 },
    }))).resolves.toMatchObject({ status: 'accepted' });
    expect(calls).toEqual([
      'eof',
      'write:still-open',
      'submit:confirm',
      'eof',
      'resize:90x24',
    ]);
  });

  it('保留 runner 的稳定交互拒绝，不把输入预算耗尽改写成平台失败', async () => {
    const owner = createOwner();
    const process = await startProcess({
      owner,
      conversationId: 'interaction-stable-rejection',
      mode: 'pty',
      interaction: {
        ...createNoopPtyInteraction(),
        async write() {
          return { status: 'rejected', code: 'input_budget_exceeded' };
        },
      },
    });

    await expect(owner.controlInteraction(createRequest({
      binding: process.binding,
      action: { type: 'write', input: 'over-budget' },
    }))).resolves.toEqual({
      status: 'rejected',
      code: 'input_budget_exceeded',
    });
    await expect(owner.controlInteraction(createRequest({
      binding: process.binding,
      action: { type: 'resize', columns: 90, rows: 30 },
    }))).resolves.toMatchObject({ status: 'accepted' });
  });

  it('cancel 不等待慢交互队列，并让排队动作在执行前失效', async () => {
    const owner = createOwner();
    const write = createDeferred<void>();
    const writeEntered = createDeferred<void>();
    let resizeCount = 0;
    const process = await startProcess({
      owner,
      conversationId: 'interaction-cancel',
      mode: 'pty',
      interaction: {
        ...createNoopPtyInteraction(),
        async write() {
          writeEntered.resolve();
          await write.promise;
        },
        async resize() {
          resizeCount += 1;
        },
      },
      onStop() {
        // 正式 PTY adapter 也必须通过关闭底层句柄结算在途写入，不能只让 owner 先返回。
        write.reject(new Error('PTY stopped'));
      },
    });

    const writing = owner.controlInteraction(createRequest({
      binding: process.binding,
      action: { type: 'write', input: 'blocking input' },
    }));
    const queuedResize = owner.controlInteraction(createRequest({
      binding: process.binding,
      action: { type: 'resize', columns: 80, rows: 25 },
    }));
    await writeEntered.promise;
    const cancelRequest = parseProcessControlRequest({
      protocol_version: 1,
      kind: 'process_control_request',
      process_handle: process.binding.process_handle,
      scope: {
        conversation_id: process.identity.conversation_id,
        agent_run_id: process.identity.agent_run_id,
        control_tool_call_id: 'interaction-cancel-call',
        owner_generation_id: process.identity.owner_generation_id,
      },
      action: { type: 'cancel' },
    });
    if (!isProcessCancellationRequest(cancelRequest)) throw new Error('cancel request mismatch');

    await expect(owner.cancelAndWait(cancelRequest)).resolves.toMatchObject({
      status: 'terminal',
      terminal: { termination_cause: 'user_cancelled' },
    });
    await expect(writing).resolves.toEqual({ status: 'rejected', code: 'incompatible_state' });
    await expect(queuedResize).resolves.toEqual({
      status: 'rejected',
      code: 'incompatible_state',
    });
    expect(resizeCount).toBe(0);
  });

  it('隐藏、跨对话和终态 handle 均不能触碰 runtime，原生错误只投影稳定错误码', async () => {
    const owner = createOwner();
    let writeCount = 0;
    const process = await startProcess({
      owner,
      conversationId: 'interaction-scope',
      mode: 'pty',
      publish: false,
      interaction: {
        ...createNoopPtyInteraction(),
        async write() {
          writeCount += 1;
          throw new Error('EPIPE with platform-specific details');
        },
      },
    });
    const writeRequest = createRequest({
      binding: process.binding,
      action: { type: 'write', input: 'answer' },
    });
    await expect(owner.controlInteraction(writeRequest)).resolves.toEqual({
      status: 'rejected',
      code: 'unknown_handle',
    });
    expect(owner.publishHandle(process.binding).status).toBe('published');
    await expect(owner.controlInteraction(createRequest({
      binding: process.binding,
      action: { type: 'write', input: 'answer' },
      conversationId: 'another-conversation',
    }))).resolves.toEqual({ status: 'rejected', code: 'unknown_handle' });
    await expect(owner.controlInteraction(writeRequest)).resolves.toEqual({
      status: 'rejected',
      code: 'interaction_failed',
    });
    expect(writeCount).toBe(1);

    process.terminal.resolve(createTerminal(process.identity));
    await Promise.resolve();
    await expect(owner.controlInteraction(writeRequest)).resolves.toEqual({
      status: 'rejected',
      code: 'incompatible_state',
    });
    expect(writeCount).toBe(1);
  });

  it('在 start 前拒绝 execution mode 与 runtime capability 不一致的内部接线', async () => {
    const owner = createOwner();
    const identity = createIdentity('interaction-mode-mismatch');
    const reserved = owner.reserve({ identity, mode: 'pipe' });
    if (reserved.status !== 'reserved') throw new Error('reservation rejected');
    let startCount = 0;

    await expect(owner.claimAndStart({
      binding: reserved.binding,
      prepareRuntime: () => ({
        interaction: createNoopPtyInteraction(),
        outputObservation: createBoundedPipeCommandOutputObservation({
          maxEvents: 16,
          maxCharacters: 1_000,
        }),
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: new Promise<CommandExecutionTerminalV1>(() => {}),
        async start() {
          startCount += 1;
          return { status: 'running', startedAtMs: 200 };
        },
        async stopAndWait() {
          throw new Error('mismatched runtime must not be started');
        },
      }),
    })).rejects.toThrow(/interaction capability does not match execution mode/u);
    expect(startCount).toBe(0);
    expect(owner.readActivitySnapshot()).toMatchObject({
      reservedCount: 0,
      startingCount: 0,
      runningCount: 0,
    });
  });
});
