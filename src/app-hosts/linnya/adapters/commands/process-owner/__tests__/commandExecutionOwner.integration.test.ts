import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import {
  CommandExecutionIdentitySchema,
  CommandAgentRunIdSchema,
  CommandConversationIdSchema,
  CommandOwnerGenerationIdSchema,
  CommandProcessHandleSchema,
  parseCommandExecutionTerminal,
  type CommandExecutionIdentity,
  type CommandExecutionTerminalV1,
  type CommandOwnerTerminationCause,
} from '@app/schemas/commands';
import {
  CLOSED_COMMAND_EXECUTION_INTERACTION,
  createUnavailableCommandSettledTextOutput,
  type CommandExecutionRuntimeStopCause,
  type PreparedCommandExecutionRuntime,
} from '../../../../../../domains/commands';
import {
  createBoundedPipeCommandOutputObservation,
} from '../../../../../../infra/adapters/command-runtime/output';
import { createLocalCommandExecutionOwner } from '../orchestration/createLocalCommandExecutionOwner';
import { createCommandAgentRunLifecycle } from '../orchestration/createCommandAgentRunLifecycle';

const OWNER_GENERATION = CommandOwnerGenerationIdSchema.parse(
  'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
);
const OTHER_GENERATION = CommandOwnerGenerationIdSchema.parse(
  'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2e',
);

const unavailableSettledTextOutput = () => Promise.resolve(
  createUnavailableCommandSettledTextOutput('pipe'),
);

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
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

function createIdentity(input: {
  readonly conversationId?: string;
  readonly agentRunId?: string;
  readonly executionId?: string;
  readonly generationId?: string;
} = {}): CommandExecutionIdentity {
  return CommandExecutionIdentitySchema.parse({
    conversation_id: input.conversationId ?? 'owner-conversation-a',
    agent_run_id: input.agentRunId ?? 'owner-agent-run',
    origin_tool_call_id: 'owner-shell-call',
    command_execution_id: input.executionId ?? `command_execution_${randomUUID()}`,
    owner_generation_id: input.generationId ?? OWNER_GENERATION,
    created_at_ms: 1_785_585_600_000,
  });
}

function createTerminal(input: {
  readonly identity: CommandExecutionIdentity;
  readonly cause?: 'natural_exit' | CommandOwnerTerminationCause;
  readonly failure?: 'launch_failed';
  readonly treeCleanupFailed?: boolean;
  readonly resourceReleaseFailed?: boolean;
}): CommandExecutionTerminalV1 {
  if (input.failure) {
    return parseCommandExecutionTerminal({
      protocol_version: 1,
      kind: 'command_execution_terminal',
      identity: input.identity,
      settled_at_ms: 1_785_585_601_000,
      outcome: 'runtime_failure',
      failure: { code: input.failure },
      process_exit: { status: 'not_started' },
      output_drain: { status: 'not_started' },
      tree_cleanup: { status: 'not_required' },
      resource_release: { status: 'not_required' },
    });
  }
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity: input.identity,
    settled_at_ms: 1_785_585_601_000,
    outcome: 'execution_ended',
    termination_cause: input.cause ?? 'natural_exit',
    process_exit: { status: 'observed', exit_code: 0, signal: null },
    output_drain: { status: 'complete' },
    tree_cleanup: input.treeCleanupFailed
      ? { status: 'failed', code: 'tree_cleanup_failed' }
      : input.cause === 'owner_ended'
        ? { status: 'succeeded' }
        : { status: 'not_required' },
    resource_release: input.resourceReleaseFailed
      ? { status: 'failed', code: 'resource_release_failed' }
      : { status: 'succeeded' },
  });
}

function createOwner() {
  return createLocalCommandExecutionOwner({
    generationId: OWNER_GENERATION,
    createProcessHandle: () => CommandProcessHandleSchema.parse(
      `command_process_${randomUUID()}`,
    ),
    now: () => 1_785_585_602_000,
  });
}

function createOutputObservation() {
  return createBoundedPipeCommandOutputObservation({
    maxEvents: 1_024,
    maxCharacters: 4_000,
  });
}

function reserve(owner: ReturnType<typeof createOwner>, identity: CommandExecutionIdentity) {
  const result = owner.reserve({ identity, mode: 'pipe' });
  expect(result.status).toBe('reserved');
  if (result.status !== 'reserved') throw new Error('reservation rejected');
  return result.binding;
}

describe('local command execution owner', () => {
  it('并发 reservation 原子占用四个名额，第五条立即拒绝且不同 owner 不共享容量', async () => {
    const owner = createOwner();
    const identities = Array.from({ length: 5 }, (_, index) => createIdentity({
      executionId: `command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d3${index}`,
    }));
    const reservations = await Promise.all(identities.map(identity => (
      Promise.resolve().then(() => owner.reserve({ identity, mode: 'pipe' }))
    )));

    const accepted = reservations.filter(result => result.status === 'reserved');
    expect(accepted).toHaveLength(4);
    expect(reservations.filter(result => result.status === 'rejected')).toEqual([{
      status: 'rejected',
      code: 'capacity_unavailable',
    }]);
    expect(owner.readActivitySnapshot().reservedCount).toBe(4);

    const independentOwner = createOwner();
    expect(independentOwner.reserve({ identity: createIdentity(), mode: 'pipe' }).status)
      .toBe('reserved');

    const released = accepted[0];
    if (released?.status !== 'reserved') throw new Error('first reservation must be accepted');
    expect(owner.release(released.binding)).toEqual({ status: 'released' });
    expect(owner.reserve({ identity: identities[4], mode: 'pipe' }).status).toBe('reserved');
  });

  it('starting、running 和 stopping 都持续占用名额，可信收尾后才允许重试', async () => {
    const owner = createOwner();
    const retainedBindings = Array.from({ length: 3 }, (_, index) => reserve(owner, createIdentity({
      executionId: `command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4e0${index}`,
    })));
    const transitioningIdentity = createIdentity({
      agentRunId: 'capacity-transition-run',
      executionId: 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4ef0',
    });
    const transitioningBinding = reserve(owner, transitioningIdentity);
    const retryIdentity = createIdentity({
      executionId: 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4ef1',
    });
    const startEntered = createDeferred<void>();
    const continueStart = createDeferred<void>();
    const stopEntered = createDeferred<void>();
    const runtimeTerminal = createDeferred<CommandExecutionTerminalV1>();
    const starting = owner.claimAndStart({
      binding: transitioningBinding,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation: createOutputObservation(),
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: runtimeTerminal.promise,
        async start() {
          startEntered.resolve();
          await continueStart.promise;
          return { status: 'running', startedAtMs: 200 };
        },
        async stopAndWait() {
          stopEntered.resolve();
          return runtimeTerminal.promise;
        },
      }),
    });

    await startEntered.promise;
    expect(owner.readActivitySnapshot()).toMatchObject({
      reservedCount: 3,
      startingCount: 1,
    });
    expect(owner.reserve({ identity: retryIdentity, mode: 'pipe' }))
      .toEqual({ status: 'rejected', code: 'capacity_unavailable' });

    continueStart.resolve();
    await expect(starting).resolves.toMatchObject({ status: 'running' });
    expect(owner.readActivitySnapshot()).toMatchObject({
      reservedCount: 3,
      runningCount: 1,
    });
    expect(owner.reserve({ identity: retryIdentity, mode: 'pipe' }))
      .toEqual({ status: 'rejected', code: 'capacity_unavailable' });

    owner.beginAgentRunStop({
      conversationId: transitioningIdentity.conversation_id,
      agentRunId: transitioningIdentity.agent_run_id,
    });
    const stopping = owner.stopAgentRunAndWait({
      conversationId: transitioningIdentity.conversation_id,
      agentRunId: transitioningIdentity.agent_run_id,
    });
    await stopEntered.promise;
    expect(owner.readActivitySnapshot()).toMatchObject({
      reservedCount: 3,
      stoppingCount: 1,
    });
    expect(owner.reserve({ identity: retryIdentity, mode: 'pipe' }))
      .toEqual({ status: 'rejected', code: 'capacity_unavailable' });

    runtimeTerminal.resolve(createTerminal({
      identity: transitioningIdentity,
      cause: 'owner_ended',
    }));
    await stopping;
    expect(owner.reserve({ identity: retryIdentity, mode: 'pipe' }).status).toBe('reserved');
    for (const binding of retainedBindings) owner.release(binding);
  });

  it('在审批前登记 reservation，并拒绝重复 execution 与错误 generation', () => {
    const owner = createOwner();
    const identity = createIdentity();
    const binding = reserve(owner, identity);
    expect(owner.readActivitySnapshot()).toMatchObject({
      lifecycle: 'active',
      reservedCount: 1,
      startingCount: 0,
      runningCount: 0,
    });

    expect(owner.reserve({ identity, mode: 'pipe' })).toEqual({
      status: 'rejected',
      code: 'duplicate_execution',
    });
    expect(owner.reserve({
      identity: createIdentity({ generationId: OTHER_GENERATION }),
      mode: 'pipe',
    })).toEqual({ status: 'rejected', code: 'scope_mismatch' });
    expect(owner.release(binding)).toEqual({ status: 'released' });
    expect(owner.readActivitySnapshot().reservedCount).toBe(0);
  });

  it('删除先赢时让迟到批准无法执行启动 callback', async () => {
    const owner = createOwner();
    const identity = createIdentity();
    const binding = reserve(owner, identity);
    let prepareCount = 0;

    owner.beginConversationStop(identity.conversation_id);
    const start = await owner.claimAndStart({
      binding,
      prepareRuntime: () => {
        prepareCount += 1;
        throw new Error('late runtime preparation must not run');
      },
    });
    expect(start).toEqual({ status: 'rejected', code: 'conversation_stopping' });
    expect(prepareCount).toBe(0);
    await owner.stopConversationAndWait(identity.conversation_id);
    expect(owner.readActivitySnapshot()).toMatchObject({
      reservedCount: 0,
      startingCount: 0,
      runningCount: 0,
      stoppingCount: 0,
    });
  });

  it('Agent run 结束只收口自己的 execution，并拒绝该 run 的迟到启动', async () => {
    const owner = createOwner();
    const endingIdentity = createIdentity({ agentRunId: 'owner-agent-run-ending' });
    const siblingIdentity = createIdentity({ agentRunId: 'owner-agent-run-sibling' });
    const endingBinding = reserve(owner, endingIdentity);
    const siblingBinding = reserve(owner, siblingIdentity);

    owner.beginAgentRunStop({
      conversationId: endingIdentity.conversation_id,
      agentRunId: endingIdentity.agent_run_id,
    });
    await expect(owner.claimAndStart({
      binding: endingBinding,
      prepareRuntime: () => { throw new Error('ending run must not prepare runtime'); },
    })).resolves.toEqual({ status: 'rejected', code: 'conversation_stopping' });
    await expect(owner.stopAgentRunAndWait({
      conversationId: endingIdentity.conversation_id,
      agentRunId: endingIdentity.agent_run_id,
    })).resolves.toBeUndefined();

    const lateIdentity = createIdentity({ agentRunId: endingIdentity.agent_run_id });
    expect(owner.reserve({ identity: lateIdentity, mode: 'pipe' })).toEqual({
      status: 'rejected',
      code: 'conversation_stopping',
    });
    expect(owner.readActivitySnapshot().agentRunStopBarrierCount).toBe(1);

    expect(owner.readActivitySnapshot().reservedCount).toBe(1);
    expect(owner.release(siblingBinding)).toEqual({ status: 'released' });
  });

  it('Agent 最外层退出后精准释放停止屏障，顺序 run 不在 owner 内累积', async () => {
    const owner = createOwner();
    const lifecycle = createCommandAgentRunLifecycle(owner);

    for (let index = 0; index < 2_000; index += 1) {
      const barrier = await lifecycle.endAgentRun({
        conversationId: CommandConversationIdSchema.parse('owner-conversation-sequential'),
        agentRunId: CommandAgentRunIdSchema.parse(`owner-agent-run-${index}`),
      });
      expect(owner.readActivitySnapshot().agentRunStopBarrierCount).toBe(1);
      barrier.release();
    }

    expect(owner.readActivitySnapshot().agentRunStopBarrierCount).toBe(0);
  });

  it('starting 期间删除会消费迟到 runtime、停止它并等待可信终态', async () => {
    const owner = createOwner();
    const identity = createIdentity();
    const binding = reserve(owner, identity);
    const startEntered = createDeferred<void>();
    const releaseStart = createDeferred<void>();
    const stopCalled = createDeferred<CommandExecutionRuntimeStopCause>();
    const terminal = createDeferred<CommandExecutionTerminalV1>();
    const runtime: PreparedCommandExecutionRuntime = {
      interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
      outputObservation: createOutputObservation(),
      settledTextOutput: unavailableSettledTextOutput(),
      terminal: terminal.promise,
      async start() {
        startEntered.resolve();
        await releaseStart.promise;
        return { status: 'running', startedAtMs: 200 };
      },
      async stopAndWait(cause) {
        stopCalled.resolve(cause);
        return terminal.promise;
      },
    };

    const starting = owner.claimAndStart({
      binding,
      prepareRuntime: () => runtime,
    });
    await startEntered.promise;
    expect(owner.readActivitySnapshot().startingCount).toBe(1);

    owner.beginConversationStop(identity.conversation_id);
    const stopping = owner.stopConversationAndWait(identity.conversation_id);
    await expect(stopCalled.promise).resolves.toBe('owner_ended');
    expect(owner.readActivitySnapshot().stoppingCount).toBe(1);

    releaseStart.resolve();
    terminal.resolve(createTerminal({ identity, cause: 'owner_ended' }));
    await expect(starting).resolves.toMatchObject({
      status: 'terminal',
      terminal: { termination_cause: 'owner_ended' },
    });
    await expect(stopping).resolves.toBeUndefined();
    expect(owner.readActivitySnapshot().stoppingCount).toBe(0);
  });

  it('runtime start 抛错时先由既有 owner 收口，不能释放成无人接管的 execution', async () => {
    const owner = createOwner();
    const identity = createIdentity();
    const binding = reserve(owner, identity);
    const terminal = createDeferred<CommandExecutionTerminalV1>();
    const stopEntered = createDeferred<void>();
    let simulatedResourceOwned = false;
    let acceptedStopCause: CommandExecutionRuntimeStopCause | undefined;
    let stopCount = 0;
    const failedTerminal = parseCommandExecutionTerminal({
      protocol_version: 1,
      kind: 'command_execution_terminal',
      identity,
      settled_at_ms: 1_785_585_601_000,
      outcome: 'runtime_failure',
      failure: { code: 'internal_failure' },
      process_exit: { status: 'observed', exit_code: 1, signal: null },
      output_drain: { status: 'complete' },
      tree_cleanup: { status: 'succeeded' },
      resource_release: { status: 'succeeded' },
    });

    const failedStart = owner.claimAndStart({
      binding,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation: createOutputObservation(),
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: terminal.promise,
        async start() {
          simulatedResourceOwned = true;
          throw new Error('reader setup failed after spawn');
        },
        async stopAndWait(cause) {
          stopCount += 1;
          acceptedStopCause = cause;
          simulatedResourceOwned = false;
          stopEntered.resolve();
          return terminal.promise;
        },
      }),
    });
    await stopEntered.promise;
    owner.beginConversationStop(identity.conversation_id);
    terminal.resolve(failedTerminal);
    await expect(failedStart).resolves.toMatchObject({
      status: 'terminal',
      terminal: { outcome: 'runtime_failure', failure: { code: 'internal_failure' } },
    });
    expect(acceptedStopCause).toBe('runtime_start_failed');
    expect(stopCount).toBe(1);
    expect(simulatedResourceOwned).toBe(false);
    expect(owner.readActivitySnapshot()).toMatchObject({
      startingCount: 0,
      runningCount: 0,
      stoppingCount: 0,
    });
  });

  it('owner stop 先于 start rejection 时保留首次原因且只停止一次', async () => {
    const owner = createOwner();
    const identity = createIdentity();
    const binding = reserve(owner, identity);
    const startEntered = createDeferred<void>();
    const rejectStart = createDeferred<void>();
    const stopEntered = createDeferred<CommandExecutionRuntimeStopCause>();
    const terminal = createDeferred<CommandExecutionTerminalV1>();
    let stopCount = 0;

    const failedStart = owner.claimAndStart({
      binding,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation: createOutputObservation(),
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: terminal.promise,
        async start() {
          startEntered.resolve();
          await rejectStart.promise;
          throw new Error('reader setup failed after owner stop');
        },
        async stopAndWait(cause) {
          stopCount += 1;
          stopEntered.resolve(cause);
          return terminal.promise;
        },
      }),
    });
    await startEntered.promise;
    owner.beginConversationStop(identity.conversation_id);
    await expect(stopEntered.promise).resolves.toBe('owner_ended');
    rejectStart.resolve();
    terminal.resolve(createTerminal({ identity, cause: 'owner_ended' }));
    await expect(failedStart).resolves.toMatchObject({
      status: 'terminal',
      terminal: { termination_cause: 'owner_ended' },
    });
    expect(stopCount).toBe(1);
    await expect(owner.stopConversationAndWait(identity.conversation_id)).resolves.toBeUndefined();
  });

  it('一个 runtime 同步停止失败时仍通知同对话的其他 runtime 并阻断 barrier', async () => {
    const owner = createOwner();
    const identityA = createIdentity();
    const identityB = createIdentity();
    const bindingA = reserve(owner, identityA);
    const bindingB = reserve(owner, identityB);
    const terminalA = createDeferred<CommandExecutionTerminalV1>();
    const terminalB = createDeferred<CommandExecutionTerminalV1>();
    let stopACount = 0;
    let stopBCount = 0;

    await owner.claimAndStart({
      binding: bindingA,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation: createOutputObservation(),
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: terminalA.promise,
        async start() {
          return { status: 'running', startedAtMs: 200 };
        },
        stopAndWait() {
          stopACount += 1;
          if (stopACount === 1) {
            throw new Error('native stop failed synchronously');
          }
          const stopped = createTerminal({ identity: identityA, cause: 'owner_ended' });
          terminalA.resolve(stopped);
          return Promise.resolve(stopped);
        },
      }),
    });
    await owner.claimAndStart({
      binding: bindingB,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation: createOutputObservation(),
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: terminalB.promise,
        async start() {
          return { status: 'running', startedAtMs: 200 };
        },
        async stopAndWait() {
          stopBCount += 1;
          const stopped = createTerminal({ identity: identityB, cause: 'owner_ended' });
          terminalB.resolve(stopped);
          return stopped;
        },
      }),
    });

    owner.beginConversationStop(identityA.conversation_id);
    await expect(owner.stopConversationAndWait(identityA.conversation_id)).rejects.toMatchObject({
      name: 'LocalCommandExecutionOwnerError',
    });
    expect(stopBCount).toBe(1);
    expect(owner.readActivitySnapshot().stoppingCount).toBe(1);
    await expect(owner.stopConversationAndWait(identityA.conversation_id)).resolves.toBeUndefined();
    expect(stopACount).toBe(2);
    expect(stopBCount).toBe(1);
    expect(owner.readActivitySnapshot().stoppingCount).toBe(0);
  });

  it.each([
    ['整树清理', { treeCleanupFailed: true }],
    ['运行资源释放', { resourceReleaseFailed: true }],
  ] as const)('%s失败的停止终态会持续阻断删除，而不是从 activity 中消失', async (
    _failureName,
    terminalFailure,
  ) => {
    const owner = createOwner();
    const identity = createIdentity();
    const binding = reserve(owner, identity);
    const terminal = createDeferred<CommandExecutionTerminalV1>();
    let stopCount = 0;

    await owner.claimAndStart({
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
          const stopped = createTerminal({
            identity,
            cause: 'owner_ended',
            ...terminalFailure,
          });
          terminal.resolve(stopped);
          return stopped;
        },
      }),
    });

    owner.beginConversationStop(identity.conversation_id);
    await expect(owner.stopConversationAndWait(identity.conversation_id)).rejects.toMatchObject({
      name: 'LocalCommandExecutionOwnerError',
      message: 'Failed to stop 1 command execution(s)',
      causes: [{
        message: expect.stringContaining('cannot release deletion barrier'),
      }],
    });
    expect(owner.readActivitySnapshot()).toMatchObject({
      runningCount: 0,
      stoppingCount: 1,
    });

    await expect(owner.stopConversationAndWait(identity.conversation_id)).rejects.toMatchObject({
      name: 'LocalCommandExecutionOwnerError',
    });
    expect(stopCount).toBe(1);
    expect(owner.readActivitySnapshot().stoppingCount).toBe(1);
  });

  it('自然终态明确报告资源释放失败时仍保留 activity，后续删除不能漏过', async () => {
    const owner = createOwner();
    const identity = createIdentity();
    const binding = reserve(owner, identity);
    const terminal = createDeferred<CommandExecutionTerminalV1>();
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
          return terminal.promise;
        },
      }),
    });
    expect(started.status).toBe('running');

    terminal.resolve(createTerminal({ identity, resourceReleaseFailed: true }));
    if (started.status !== 'running') throw new Error('runtime did not start');
    await expect(started.terminal).resolves.toMatchObject({
      resource_release: { status: 'failed', code: 'resource_release_failed' },
    });
    expect(owner.readActivitySnapshot()).toMatchObject({
      runningCount: 0,
      stoppingCount: 1,
    });

    await expect(owner.stopConversationAndWait(identity.conversation_id)).rejects.toMatchObject({
      name: 'LocalCommandExecutionOwnerError',
      causes: [{ message: expect.stringContaining('resource_release_failed') }],
    });
    expect(owner.readActivitySnapshot().stoppingCount).toBe(1);
  });

  it('超快进程在 start 返回前已形成终态时不能被重新标成 running', async () => {
    const owner = createOwner();
    const identity = createIdentity();
    const binding = reserve(owner, identity);
    const terminal = createDeferred<CommandExecutionTerminalV1>();
    const naturalTerminal = createTerminal({ identity });

    const started = await owner.claimAndStart({
      binding,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation: createOutputObservation(),
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: terminal.promise,
        async start() {
          terminal.resolve(naturalTerminal);
          await Promise.resolve();
          return { status: 'running', startedAtMs: 200 };
        },
        async stopAndWait() {
          return naturalTerminal;
        },
      }),
    });
    expect(started).toMatchObject({
      status: 'terminal',
      terminal: { termination_cause: 'natural_exit' },
    });
    expect(owner.readActivitySnapshot()).toMatchObject({
      startingCount: 0,
      runningCount: 0,
    });
  });

  it('一个对话的收口不阻塞另一个对话，且自然终态释放活动记录', async () => {
    const owner = createOwner();
    const identityA = createIdentity({ conversationId: 'owner-conversation-a' });
    const identityB = createIdentity({ conversationId: 'owner-conversation-b' });
    reserve(owner, identityA);
    const bindingB = reserve(owner, identityB);
    const terminalB = createDeferred<CommandExecutionTerminalV1>();
    const startedB = await owner.claimAndStart({
      binding: bindingB,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation: createOutputObservation(),
        settledTextOutput: unavailableSettledTextOutput(),
        async start() {
          return { status: 'running', startedAtMs: 200 };
        },
        terminal: terminalB.promise,
        stopAndWait: async () => terminalB.promise,
      }),
    });
    expect(startedB.status).toBe('running');

    await owner.stopConversationAndWait(identityA.conversation_id);
    expect(owner.readActivitySnapshot()).toMatchObject({
      reservedCount: 0,
      runningCount: 1,
    });
    terminalB.resolve(createTerminal({ identity: identityB }));
    if (startedB.status !== 'running') throw new Error('conversation B did not start');
    await expect(startedB.terminal).resolves.toMatchObject({
      termination_cause: 'natural_exit',
    });
    expect(owner.readActivitySnapshot().runningCount).toBe(0);
  });

  it('启动前失败形成明确 terminal，App owner 结束后旧 generation 永久失效', async () => {
    const owner = createOwner();
    const failedIdentity = createIdentity();
    const failedBinding = reserve(owner, failedIdentity);
    await expect(owner.claimAndStart({
      binding: failedBinding,
      prepareRuntime: () => {
        const failed = createTerminal({ identity: failedIdentity, failure: 'launch_failed' });
        return {
          interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
          outputObservation: createOutputObservation(),
          settledTextOutput: unavailableSettledTextOutput(),
          terminal: Promise.resolve(failed),
          async start() {
            return { status: 'terminal', terminal: failed };
          },
          async stopAndWait() {
            return failed;
          },
        };
      },
    })).resolves.toMatchObject({
      status: 'terminal',
      terminal: { outcome: 'runtime_failure', failure: { code: 'launch_failed' } },
    });

    const pendingIdentity = createIdentity();
    const pendingBinding = reserve(owner, pendingIdentity);
    await owner.endAndWait();
    expect(owner.readActivitySnapshot()).toMatchObject({
      lifecycle: 'ended',
      reservedCount: 0,
    });
    let lateStartCount = 0;
    await expect(owner.claimAndStart({
      binding: pendingBinding,
      prepareRuntime: () => {
        lateStartCount += 1;
        throw new Error('ended owner must not prepare runtime');
      },
    })).resolves.toEqual({ status: 'rejected', code: 'owner_ended' });
    expect(lateStartCount).toBe(0);
  });

  it('坏生命周期观察者不能阻断其他观察者、terminal 或活动记录释放', async () => {
    const owner = createOwner();
    const identity = createIdentity();
    const binding = reserve(owner, identity);
    const runtimeTerminal = createDeferred<CommandExecutionTerminalV1>();
    const observed: string[] = [];
    owner.subscribeExecutionLifecycle(() => {
      throw new Error('injected projection listener failure');
    });
    owner.subscribeExecutionLifecycle(event => observed.push(event.type));
    const started = await owner.claimAndStart({
      binding,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation: createOutputObservation(),
        settledTextOutput: unavailableSettledTextOutput(),
        start: async () => ({ status: 'running', startedAtMs: 200 }),
        terminal: runtimeTerminal.promise,
        stopAndWait: async () => runtimeTerminal.promise,
      }),
    });
    expect(started.status).toBe('running');
    expect(owner.publishHandle(binding).status).toBe('published');
    runtimeTerminal.resolve(createTerminal({ identity }));
    if (started.status !== 'running') throw new Error('command did not start');
    await expect(started.terminal).resolves.toMatchObject({ termination_cause: 'natural_exit' });
    expect(observed).toEqual(['handle_published', 'terminal_settled']);
    expect(owner.readActivitySnapshot().runningCount).toBe(0);
  });
});
