import { describe, expect, it, vi } from 'vitest';

import {
  ExecutionIdSchema,
  routeRuntimeEvent,
  RunIdSchema,
  ToolCallIdSchema,
} from '../../../contracts';
import type {
  AgentSpec,
  EventEnvelope,
  RoutedRuntimeEvent,
  RuntimeEvent,
} from '../../../contracts';
import { EventBus } from '../../execution/event-bus';
import { MemoryEventStore } from '../../graph-engine/event-store/memoryEventStore';
import { DefaultRunSupervisor } from '../runSupervisor';
import type { RunCostCollector, RunRequestSnapshot } from '../runHandle';
import type { RunExecutorPort, RunOutcome } from '../definitions/runSupervisorContracts';
import {
  NotImplementedError,
  RunAlreadyRegisteredError,
  RunConcurrencyKeyOccupiedError,
  RunConcurrencyLimitExceededError,
  RunInteractionConflictError,
  RunNotFoundError,
} from '../runErrors';
import { MemoryRunRegistryStore } from '../memoryRunRegistryStore';
import type { ListRunsFilter } from '../runRegistryStorePort';

const agentSpec: AgentSpec = {
  id: 'default_agent',
  version: '1.0.0',
  capabilities: ['chat'],
  tools: [],
  contextPolicy: { profileId: 'agent' },
};

const request = {
  query: '继续',
  promptKey: 'default',
} satisfies RunRequestSnapshot;

function createRuntimeEvent(id: string): RoutedRuntimeEvent {
  return routeRuntimeEvent(
    {
      type: 'thought',
      id,
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      timestamp: 100,
      version: 1,
      content: id,
      is_complete: false,
    },
    {
      run_id: 'run-1',
      lane: 'foreground',
      visibility: 'conversation',
    }
  );
}

function createRuntimeEventForRun(id: string, runId: string): RoutedRuntimeEvent {
  return routeRuntimeEvent(createRuntimeEvent(id), {
    run_id: runId,
    lane: 'foreground',
    visibility: 'conversation',
  });
}

function createWaitUserEvent(runId: string): RoutedRuntimeEvent {
  return routeRuntimeEvent(
    {
      type: 'requires_user_interaction',
      id: 'wait-1',
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      timestamp: 101,
      version: 1,
      form: {
        prompt: '需要用户确认',
      },
      interaction_id: 'wait-1',
      run_id: runId,
      tool_call_id: 'tool-1',
      checkpoint_revision: 2,
      resume_token: 'resume-1',
      interaction_status: 'pending',
    },
    {
      run_id: runId,
      lane: 'foreground',
      visibility: 'conversation',
    }
  );
}

function wrapEvent(
  event: RuntimeEvent,
  seq: number,
  executionId = 'exec-1'
): EventEnvelope<RuntimeEvent> {
  return {
    seq,
    timestamp: event.timestamp,
    trace: { execution_id: executionId },
    source: 'test',
    payload: event,
  };
}

async function collectEvents(
  iterable: AsyncIterable<RuntimeEvent>,
  count: number
): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
    if (events.length >= count) {
      break;
    }
  }
  return events;
}

async function nextTask(): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });
}

function createCostCollector(): RunCostCollector {
  return {
    snapshot: () => ({ tokensInput: 7, tokensOutput: 3 }),
  };
}

function createResumeInteraction() {
  return {
    interactionId: 'wait-1',
    toolCallId: ToolCallIdSchema.parse('tool-1'),
    checkpointRevision: 2,
    resumeToken: 'resume-1',
  };
}

async function registerOneRun() {
  const registryStore = new MemoryRunRegistryStore();
  const supervisor = new DefaultRunSupervisor({
    registryStore,
    runIdFactory: () => RunIdSchema.parse('run-1'),
    now: () => 10,
  });
  const eventBus = new EventBus('exec-1');
  const eventStore = new MemoryEventStore();
  const handle = await supervisor.registerRun({
    conversationId: 'conv-1',
    parentRunId: RunIdSchema.parse('parent-1'),
    agentSpec,
    request,
    eventBus,
    eventStore,
    costCollector: createCostCollector(),
    metadata: {
      executionId: 'exec-1',
      turnId: 'turn-1',
    },
  });

  return { registryStore, supervisor, eventBus, handle };
}

describe('DefaultRunSupervisor', () => {
  it('registerRun 生成 runId、写 pending RunRecord，并返回 handle', async () => {
    const { registryStore, handle } = await registerOneRun();

    expect(handle.runId).toBe('run-1');
    expect(handle.parentRunId).toBe('parent-1');
    await expect(registryStore.load(RunIdSchema.parse('run-1'))).resolves.toMatchObject({
      runId: 'run-1',
      conversationId: 'conv-1',
      parentRunId: 'parent-1',
      agentSpecId: 'default_agent',
      status: 'pending',
      startedAt: 10,
      updatedAt: 10,
      metadata: {
        executionId: 'exec-1',
        turnId: 'turn-1',
      },
    });
  });

  it('显式传入 runId 时 RunRecord.runId 与传入值相等', async () => {
    const registryStore = new MemoryRunRegistryStore();
    const supervisor = new DefaultRunSupervisor({
      registryStore,
      runIdFactory: () => RunIdSchema.parse('generated-run'),
      now: () => 10,
    });

    const handle = await supervisor.registerRun({
      runId: RunIdSchema.parse('turn_abc'),
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus: new EventBus('exec-1'),
      eventStore: new MemoryEventStore(),
      costCollector: createCostCollector(),
    });

    expect(handle.runId).toBe('turn_abc');
    await expect(registryStore.load(RunIdSchema.parse('turn_abc'))).resolves.toMatchObject({
      runId: 'turn_abc',
      conversationId: 'conv-1',
      agentSpecId: 'default_agent',
      status: 'pending',
    });
  });

  it('同 runId 注册 2 次抛 RunAlreadyRegisteredError，第一次 handle 仍可用', async () => {
    const { supervisor, handle } = await registerOneRun();

    await expect(
      supervisor.registerRun({
        runId: RunIdSchema.parse('run-1'),
        conversationId: 'conv-1',
        agentSpec,
        request,
        eventBus: new EventBus('exec-duplicate'),
        eventStore: new MemoryEventStore(),
        costCollector: createCostCollector(),
      })
    ).rejects.toBeInstanceOf(RunAlreadyRegisteredError);

    await expect(handle.meta()).resolves.toMatchObject({
      runId: 'run-1',
      status: 'pending',
    });
  });

  it('parentSignal abort 时 runHandle.signal 级联 abort', async () => {
    const registryStore = new MemoryRunRegistryStore();
    const parentController = new AbortController();
    const supervisor = new DefaultRunSupervisor({ registryStore });

    const handle = await supervisor.registerRun({
      runId: RunIdSchema.parse('turn_abc'),
      parentSignal: parentController.signal,
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus: new EventBus('exec-1'),
      eventStore: new MemoryEventStore(),
      costCollector: createCostCollector(),
    });

    parentController.abort('parent reason');

    expect(handle.signal.aborted).toBe(true);
    expect(handle.signal.reason).toBe('parent reason');
  });

  it('peek 能读取 RunMeta', async () => {
    const { supervisor } = await registerOneRun();

    await expect(supervisor.peek(RunIdSchema.parse('run-1'))).resolves.toMatchObject({
      runId: 'run-1',
      parentRunId: 'parent-1',
      agentSpecId: 'default_agent',
      status: 'pending',
    });
  });

  it('list 能按 RunRegistryStore 过滤并返回 RunMeta', async () => {
    const { supervisor } = await registerOneRun();

    await expect(supervisor.list({ agentSpecId: 'default_agent' })).resolves.toMatchObject({
      runs: [
        {
          runId: 'run-1',
          agentSpecId: 'default_agent',
          status: 'pending',
        },
      ],
    });
  });

  it('cancel 通过 handle 取消 run 并写 cancelled 状态', async () => {
    const { registryStore, supervisor } = await registerOneRun();

    await supervisor.cancel(RunIdSchema.parse('run-1'), { reason: '用户取消', forceCleanup: true });

    await expect(registryStore.load(RunIdSchema.parse('run-1'))).resolves.toMatchObject({
      status: 'cancelled',
      errorIfAny: {
        errorCode: 'RUN_CANCELLED',
        message: '用户取消',
      },
      metadata: {
        cancel: {
          reason: '用户取消',
          forceCleanup: true,
        },
      },
    });
  });

  it('直接调用 handle.cancel 也会唤醒 waitForTerminal', async () => {
    const { supervisor, handle } = await registerOneRun();
    const waitPromise = supervisor.waitForTerminal(RunIdSchema.parse('run-1'));

    await handle.cancel({ reason: '直接取消' });

    await expect(waitPromise).resolves.toMatchObject({
      runId: 'run-1',
      status: 'cancelled',
      error: {
        errorCode: 'RUN_CANCELLED',
        message: '直接取消',
        recoverable: false,
      },
    });
  });

  it('markAwaitingUser 写入 awaiting_user 状态', async () => {
    const { registryStore, supervisor } = await registerOneRun();

    await supervisor.markAwaitingUser(RunIdSchema.parse('run-1'), {
      currentNode: 'wait_user',
      eventId: 'wait-1',
      reason: '需要用户确认',
    });

    const record = await registryStore.load(RunIdSchema.parse('run-1'));
    expect(record).toMatchObject({
      status: 'awaiting_user',
      currentNode: 'wait_user',
      pauseReason: '需要用户确认',
      metadata: {
        awaitingUser: {
          eventId: 'wait-1',
          reason: '需要用户确认',
        },
      },
    });
    expect(record?.pausedAt).toEqual(expect.any(Number));
  });

  it('requires_user_interaction 事件会联动 RunRecord.status=awaiting_user', async () => {
    const { registryStore, eventBus } = await registerOneRun();

    eventBus.publish(wrapEvent(createWaitUserEvent('run-1'), 1));
    await nextTask();

    await expect(registryStore.load(RunIdSchema.parse('run-1'))).resolves.toMatchObject({
      status: 'awaiting_user',
      currentNode: 'wait_user',
      pauseReason: '需要用户确认',
      metadata: {
        awaitingUser: {
          eventId: 'wait-1',
          reason: '需要用户确认',
        },
      },
    });
  });

  it('transport 关闭后仍能恢复同一个 awaiting run，且第二次恢复被拒绝', async () => {
    const { registryStore, supervisor, eventBus, handle } = await registerOneRun();
    const interaction = createResumeInteraction();
    await handle.markAwaitingUser({ currentNode: 'wait_user', eventId: 'wait-1', interaction });

    eventBus.close();
    await nextTask();

    const resumeClaim = await supervisor.claimResume(
      RunIdSchema.parse('run-1'),
      interaction,
      new EventBus('exec-resume')
    );
    const resumedHandle = await resumeClaim.activate({
      executionId: ExecutionIdSchema.parse('execution-resume-2'),
    });
    expect(resumedHandle).toBe(handle);
    await expect(resumedHandle.request()).resolves.toEqual(request);
    await expect(registryStore.load(RunIdSchema.parse('run-1'))).resolves.toMatchObject({
      runId: 'run-1',
      status: 'running',
      currentNode: 'llm',
      metadata: {
        executionId: 'execution-resume-2',
      },
    });
    await expect(
      supervisor.claimResume(
        RunIdSchema.parse('run-1'),
        interaction,
        new EventBus('exec-resume-duplicate')
      )
    ).rejects.toThrow('cannot resume from status running');
  });

  it('同一个 awaiting interaction 并发提交时只能有一个恢复成功', async () => {
    const { registryStore, supervisor, handle } = await registerOneRun();
    const interaction = createResumeInteraction();
    await handle.markAwaitingUser({ currentNode: 'wait_user', eventId: 'wait-1', interaction });

    let fulfilled = 0;
    let rejected = 0;
    const submit = (): Promise<void> =>
      supervisor
        .claimResume(RunIdSchema.parse('run-1'), interaction, new EventBus('exec-concurrent'))
        .then(async claim => {
          fulfilled += 1;
          await claim.activate();
        })
        .catch((error: unknown) => {
          expect(error).toBeInstanceOf(RunInteractionConflictError);
          rejected += 1;
        });

    await Promise.all([submit(), submit()]);

    expect({ fulfilled, rejected }).toEqual({ fulfilled: 1, rejected: 1 });
    await expect(registryStore.load(RunIdSchema.parse('run-1'))).resolves.toMatchObject({
      status: 'running',
      metadata: {
        awaitingUser: {
          interaction: {
            interactionId: 'wait-1',
            status: 'submitted',
          },
        },
      },
    });
  });

  it('取消与 interaction 恢复竞争时，先进入控制队列的取消成为唯一有效结果', async () => {
    const { registryStore, supervisor, handle } = await registerOneRun();
    const interaction = createResumeInteraction();
    await handle.markAwaitingUser({ currentNode: 'wait_user', eventId: 'wait-1', interaction });

    const cancelPromise = supervisor.cancel(RunIdSchema.parse('run-1'), {
      reason: '用户取消等待中的交互',
    });
    const resumePromise = supervisor.claimResume(
      RunIdSchema.parse('run-1'),
      interaction,
      new EventBus('exec-cancel-race')
    );

    await expect(cancelPromise).resolves.toBeUndefined();
    await expect(resumePromise).rejects.toBeInstanceOf(RunNotFoundError);
    await expect(registryStore.load(RunIdSchema.parse('run-1'))).resolves.toMatchObject({
      status: 'cancelled',
      errorIfAny: {
        errorCode: 'RUN_CANCELLED',
        message: '用户取消等待中的交互',
      },
    });
  });

  it('恢复认领在业务输入落盘前失败时可释放，同一个 interaction 随后仍可重试', async () => {
    const { registryStore, supervisor, handle } = await registerOneRun();
    const interaction = createResumeInteraction();
    await handle.markAwaitingUser({ currentNode: 'wait_user', eventId: 'wait-1', interaction });

    const failedAttempt = await supervisor.claimResume(
      RunIdSchema.parse('run-1'),
      interaction,
      new EventBus('exec-failed-attempt')
    );
    await expect(registryStore.load(RunIdSchema.parse('run-1'))).resolves.toMatchObject({
      status: 'awaiting_user',
      metadata: {
        awaitingUser: {
          interaction: { status: 'pending' },
          resumeClaim: { claimId: expect.any(String) },
        },
      },
    });

    await failedAttempt.release();
    const retry = await supervisor.claimResume(
      RunIdSchema.parse('run-1'),
      interaction,
      new EventBus('exec-retry')
    );
    await retry.activate();

    await expect(registryStore.load(RunIdSchema.parse('run-1'))).resolves.toMatchObject({
      status: 'running',
      metadata: {
        awaitingUser: {
          interaction: { status: 'submitted' },
        },
      },
    });
  });

  it('恢复认领尚未激活时 transport 断开不得取消原 awaiting run', async () => {
    const { supervisor, handle } = await registerOneRun();
    const interaction = createResumeInteraction();
    await handle.markAwaitingUser({ currentNode: 'wait_user', eventId: 'wait-1', interaction });
    const transportController = new AbortController();
    const claim = await supervisor.claimResume(
      RunIdSchema.parse('run-1'),
      interaction,
      new EventBus('exec-disconnected-before-accept'),
      transportController.signal
    );

    transportController.abort('client disconnected before response was accepted');
    await claim.release();

    expect(handle.signal.aborted).toBe(false);
    await expect(handle.meta()).resolves.toMatchObject({ status: 'awaiting_user' });
  });

  it('恢复激活时切换 execution signal，旧 transport 不能取消新执行', async () => {
    const registryStore = new MemoryRunRegistryStore();
    const supervisor = new DefaultRunSupervisor({
      registryStore,
      runIdFactory: () => RunIdSchema.parse('run-resume-signal'),
      now: () => 10,
    });
    const originalTransport = new AbortController();
    const handle = await supervisor.registerRun({
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus: new EventBus('exec-original'),
      eventStore: new MemoryEventStore(),
      costCollector: createCostCollector(),
      parentSignal: originalTransport.signal,
    });
    const interaction = createResumeInteraction();
    await handle.markAwaitingUser({ currentNode: 'wait_user', eventId: 'wait-1', interaction });

    const resumedTransport = new AbortController();
    const claim = await supervisor.claimResume(
      handle.runId,
      interaction,
      new EventBus('exec-resumed'),
      resumedTransport.signal
    );
    await claim.activate();

    originalTransport.abort('旧 SSE transport 迟到关闭');
    expect(handle.signal.aborted).toBe(false);

    resumedTransport.abort('当前 resume transport 关闭');
    expect(handle.signal.aborted).toBe(true);
    expect(handle.signal.reason).toBe('当前 resume transport 关闭');
  });

  it('同一 run 的观察流跨越首次 transport 关闭，并继续接收恢复 transport 的事件', async () => {
    const { supervisor, eventBus, handle } = await registerOneRun();
    const interaction = createResumeInteraction();
    await handle.markAwaitingUser({ currentNode: 'wait_user', eventId: 'wait-1', interaction });
    const collectPromise = collectEvents(supervisor.observeRun(RunIdSchema.parse('run-1')), 2);

    await nextTask();
    eventBus.publish(wrapEvent(createRuntimeEventForRun('before-wait', 'run-1'), 1));
    eventBus.close();

    const resumeBus = new EventBus('exec-resume-observe');
    const claim = await supervisor.claimResume(RunIdSchema.parse('run-1'), interaction, resumeBus);
    await claim.activate();
    resumeBus.publish(
      wrapEvent(createRuntimeEventForRun('after-resume', 'run-1'), 1, 'exec-resume-observe')
    );

    await expect(collectPromise).resolves.toEqual([
      createRuntimeEventForRun('before-wait', 'run-1'),
      createRuntimeEventForRun('after-resume', 'run-1'),
    ]);
  });

  it('observeRun 能委托给对应 handle 的实时事件流', async () => {
    const { supervisor, eventBus } = await registerOneRun();
    const collectPromise = collectEvents(supervisor.observeRun(RunIdSchema.parse('run-1')), 1);

    await nextTask();
    eventBus.publish(wrapEvent(createRuntimeEvent('evt-1'), 1));

    await expect(collectPromise).resolves.toEqual([createRuntimeEvent('evt-1')]);
  });

  it('observeRun 在共享 EventBus 下只返回目标 run 的实时事件', async () => {
    const registryStore = new MemoryRunRegistryStore();
    const supervisor = new DefaultRunSupervisor({
      registryStore,
      runIdFactory: () => RunIdSchema.parse('unused'),
      now: () => 10,
    });
    const sharedBus = new EventBus('exec-shared');
    const eventStore = new MemoryEventStore();
    await supervisor.registerRun({
      runId: RunIdSchema.parse('run-a'),
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus: sharedBus,
      eventStore,
      costCollector: createCostCollector(),
    });
    await supervisor.registerRun({
      runId: RunIdSchema.parse('run-b'),
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus: sharedBus,
      eventStore,
      costCollector: createCostCollector(),
    });

    const collectPromise = collectEvents(supervisor.observeRun(RunIdSchema.parse('run-a')), 1);

    await nextTask();
    sharedBus.publish(wrapEvent(createRuntimeEventForRun('evt-b', 'run-b'), 1, 'exec-shared'));
    await nextTask();
    sharedBus.publish(wrapEvent(createRuntimeEventForRun('evt-a', 'run-a'), 2, 'exec-shared'));

    await expect(collectPromise).resolves.toEqual([createRuntimeEventForRun('evt-a', 'run-a')]);
  });

  it('observeRun 的 runId 过滤契约同时约束实时事件与持久化事件', async () => {
    const registryStore = new MemoryRunRegistryStore();
    const supervisor = new DefaultRunSupervisor({
      registryStore,
      runIdFactory: () => RunIdSchema.parse('unused'),
      now: () => 10,
    });
    const sharedBus = new EventBus('exec-contract');
    const eventStore = new MemoryEventStore();
    const runAEvent = createRuntimeEventForRun('persisted-a', 'run-a');
    const runBEvent = createRuntimeEventForRun('persisted-b', 'run-b');
    await eventStore.append({
      eventStoreId: '0000000000100-0000',
      event: runBEvent,
    });
    await eventStore.append({
      eventStoreId: '0000000000101-0000',
      event: runAEvent,
    });
    await supervisor.registerRun({
      runId: RunIdSchema.parse('run-a'),
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus: sharedBus,
      eventStore,
      costCollector: createCostCollector(),
    });
    await supervisor.registerRun({
      runId: RunIdSchema.parse('run-b'),
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus: sharedBus,
      eventStore,
      costCollector: createCostCollector(),
    });

    const collectPromise = collectEvents(
      supervisor.observeRun(RunIdSchema.parse('run-a'), { includePersisted: true }),
      2
    );

    await nextTask();
    sharedBus.publish(
      wrapEvent(createRuntimeEventForRun('realtime-b', 'run-b'), 1, 'exec-contract')
    );
    await nextTask();
    sharedBus.publish(
      wrapEvent(createRuntimeEventForRun('realtime-a', 'run-a'), 2, 'exec-contract')
    );

    await expect(collectPromise).resolves.toEqual([
      runAEvent,
      createRuntimeEventForRun('realtime-a', 'run-a'),
    ]);
  });

  it('registerRun 进入终态后释放 supervisor 活跃入口，事后查询继续走 registry', async () => {
    const { supervisor, eventBus, handle } = await registerOneRun();

    await handle.markCompleted({ currentNode: 'final' });
    eventBus.close();

    await expect(supervisor.peek(RunIdSchema.parse('run-1'))).resolves.toMatchObject({
      runId: 'run-1',
      status: 'completed',
      currentNode: 'final',
    });
    await expect(supervisor.waitForTerminal(RunIdSchema.parse('run-1'))).resolves.toMatchObject({
      runId: 'run-1',
      status: 'completed',
      currentNode: 'final',
    });
    await expect(
      supervisor.cancel(RunIdSchema.parse('run-1'), { reason: 'late cancel' })
    ).rejects.toBeInstanceOf(RunNotFoundError);
    const iterator = supervisor.observeRun(RunIdSchema.parse('run-1'))[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it('不存在的 runId 在 observe/cancel 时抛 RunNotFoundError', async () => {
    const { supervisor } = await registerOneRun();

    await expect(
      supervisor.cancel(RunIdSchema.parse('missing-run'), { reason: '不存在' })
    ).rejects.toBeInstanceOf(RunNotFoundError);
    const iterator = supervisor
      .observeRun(RunIdSchema.parse('missing-run'))
      [Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it('尚未实现的 N-3.B 方法明确抛 NotImplementedError', async () => {
    const { supervisor } = await registerOneRun();

    await expect(supervisor.pause(RunIdSchema.parse('run-1'), '稍后')).rejects.toBeInstanceOf(
      NotImplementedError
    );
    await expect(supervisor.runTree(RunIdSchema.parse('run-1'))).rejects.toBeInstanceOf(
      NotImplementedError
    );
    await expect(
      new DefaultRunSupervisor({ registryStore: new MemoryRunRegistryStore() }).spawnDetached({
        conversationId: 'conv-1',
        agentSpec,
        request,
        eventBus: new EventBus('exec-detached'),
        eventStore: new MemoryEventStore(),
        costCollector: createCostCollector(),
      })
    ).rejects.toBeInstanceOf(NotImplementedError);
    await expect(
      supervisor.handleFailure(RunIdSchema.parse('run-1'), new Error('boom'))
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('spawnDetached 通过 RunExecutorPort 执行并写入 completed 终态', async () => {
    const registryStore = new MemoryRunRegistryStore();
    const execute = vi.fn<RunExecutorPort['execute']>(async context => ({
      runId: context.runId,
      status: 'completed',
      completedAt: 20,
      currentNode: 'answer',
      iterationsUsed: 3,
      metadata: {
        source: 'executor',
      },
    }));
    const supervisor = new DefaultRunSupervisor({
      registryStore,
      executor: { execute },
      runIdFactory: () => RunIdSchema.parse('detached-1'),
      now: () => 10,
    });

    const handle = await supervisor.spawnDetached({
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus: new EventBus('exec-detached'),
      eventStore: new MemoryEventStore(),
      costCollector: createCostCollector(),
      iterationBudget: { max: 8, refundable: true },
      query: '后台跑',
      wakeSource: 'test',
      metadata: { traceId: 'trace-1' },
    });
    const outcome = await supervisor.waitForTerminal(handle.runId);

    expect(handle.runId).toBe('detached-1');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'detached-1',
        parentRunId: undefined,
        conversationId: 'conv-1',
        agentSpec,
        request,
        query: '后台跑',
        wakeSource: 'test',
        metadata: { traceId: 'trace-1' },
      })
    );
    expect(outcome).toMatchObject({
      runId: 'detached-1',
      status: 'completed',
      currentNode: 'answer',
      iterationsUsed: 3,
      metadata: {
        traceId: 'trace-1',
        source: 'executor',
      },
    });
    await expect(registryStore.load(RunIdSchema.parse('detached-1'))).resolves.toMatchObject({
      status: 'completed',
      currentNode: 'answer',
      iterationsUsed: 3,
      iterationBudget: { max: 8, refundable: true },
      metadata: {
        traceId: 'trace-1',
        source: 'executor',
      },
    });
  });

  it('detached run 正常终态后清理 handle/controller，后续 observe/cancel 不再保留活跃入口', async () => {
    const registryStore = new MemoryRunRegistryStore();
    const supervisor = new DefaultRunSupervisor({
      registryStore,
      executor: {
        execute: async context => ({
          runId: context.runId,
          status: 'completed',
          completedAt: 20,
        }),
      },
      runIdFactory: () => RunIdSchema.parse('detached-cleanup'),
      now: () => 10,
    });

    const handle = await supervisor.spawnDetached({
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus: new EventBus('exec-cleanup'),
      eventStore: new MemoryEventStore(),
      costCollector: createCostCollector(),
    });

    await expect(supervisor.waitForTerminal(handle.runId)).resolves.toMatchObject({
      runId: 'detached-cleanup',
      status: 'completed',
    });
    await expect(supervisor.cancel(handle.runId, { reason: 'late cancel' })).rejects.toBeInstanceOf(
      RunNotFoundError
    );
    const iterator = supervisor.observeRun(handle.runId)[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toBeInstanceOf(RunNotFoundError);
    await expect(supervisor.waitForTerminal(handle.runId)).resolves.toMatchObject({
      runId: 'detached-cleanup',
      status: 'completed',
    });
  });

  it('EventBus.close 先发生时会同步注销 supervisor 的事件监听登记', async () => {
    const registryStore = new MemoryRunRegistryStore();
    const eventBus = new EventBus('exec-close-before-terminal');
    const offSpy = vi.spyOn(eventBus, 'off');
    let releaseExecutor!: () => void;
    const executorCanFinish = new Promise<void>(resolve => {
      releaseExecutor = resolve;
    });
    const supervisor = new DefaultRunSupervisor({
      registryStore,
      executor: {
        execute: async context => {
          await executorCanFinish;
          return {
            runId: context.runId,
            status: 'completed',
            completedAt: 20,
          };
        },
      },
      runIdFactory: () => RunIdSchema.parse('detached-close-before-terminal'),
      now: () => 10,
    });

    const handle = await supervisor.spawnDetached({
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus,
      eventStore: new MemoryEventStore(),
      costCollector: createCostCollector(),
    });

    eventBus.close();
    expect(offSpy).toHaveBeenCalledWith('event', expect.any(Function));
    expect(offSpy).toHaveBeenCalledWith('close', expect.any(Function));

    releaseExecutor();
    await expect(supervisor.waitForTerminal(handle.runId)).resolves.toMatchObject({
      runId: 'detached-close-before-terminal',
      status: 'completed',
    });
  });

  it('相同 concurrencyKey 的并发注册只有一个成功，终态后允许下一条 run', async () => {
    const registryStore = new MemoryRunRegistryStore();
    const supervisor = new DefaultRunSupervisor({ registryStore });
    const register = (runId: string) =>
      supervisor
        .registerRun({
          runId: RunIdSchema.parse(runId),
          concurrencyKey: 'conversation:conv-1:foreground',
          conversationId: 'conv-1',
          agentSpec,
          request,
          eventBus: new EventBus(`exec-${runId}`),
          eventStore: new MemoryEventStore(),
          costCollector: createCostCollector(),
        })
        .then(
          handle => ({ kind: 'registered' as const, handle }),
          (error: unknown) => ({ kind: 'rejected' as const, error })
        );

    const results = await Promise.all([register('foreground-a'), register('foreground-b')]);
    const registered = results.find(result => result.kind === 'registered');
    const rejected = results.find(result => result.kind === 'rejected');
    if (!registered || !rejected) {
      throw new Error('Expected exactly one foreground registration to succeed');
    }

    expect(rejected.error).toBeInstanceOf(RunConcurrencyKeyOccupiedError);
    await registered.handle.markCompleted();
    await expect(register('foreground-c')).resolves.toMatchObject({ kind: 'registered' });
  });

  it('maxActiveRuns 超限时拒绝新的 registerRun，并只在 run 终态后释放名额', async () => {
    const registryStore = new MemoryRunRegistryStore();
    const supervisor = new DefaultRunSupervisor({
      registryStore,
      maxActiveRuns: 1,
    });
    const firstBus = new EventBus('exec-limit-1');
    const firstHandle = await supervisor.registerRun({
      runId: RunIdSchema.parse('run-limit-1'),
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus: firstBus,
      eventStore: new MemoryEventStore(),
      costCollector: createCostCollector(),
    });

    await expect(
      supervisor.registerRun({
        runId: RunIdSchema.parse('run-limit-2'),
        conversationId: 'conv-2',
        agentSpec,
        request,
        eventBus: new EventBus('exec-limit-2'),
        eventStore: new MemoryEventStore(),
        costCollector: createCostCollector(),
      })
    ).rejects.toMatchObject({
      name: 'RunConcurrencyLimitExceededError',
      runId: 'run-limit-2',
      maxActiveRuns: 1,
      activeRuns: 1,
    });
    await expect(
      supervisor.registerRun({
        runId: RunIdSchema.parse('run-limit-2'),
        conversationId: 'conv-2',
        agentSpec,
        request,
        eventBus: new EventBus('exec-limit-3'),
        eventStore: new MemoryEventStore(),
        costCollector: createCostCollector(),
      })
    ).rejects.toBeInstanceOf(RunConcurrencyLimitExceededError);

    firstBus.close();
    await expect(
      supervisor.registerRun({
        runId: RunIdSchema.parse('run-limit-still-active'),
        conversationId: 'conv-3',
        agentSpec,
        request,
        eventBus: new EventBus('exec-limit-still-active'),
        eventStore: new MemoryEventStore(),
        costCollector: createCostCollector(),
      })
    ).rejects.toBeInstanceOf(RunConcurrencyLimitExceededError);

    await firstHandle.markCompleted();
    // close 已发生，终态写入后由下一个任务释放 supervisor 资源。
    await nextTask();

    await expect(
      supervisor.registerRun({
        runId: RunIdSchema.parse('run-limit-3'),
        conversationId: 'conv-3',
        agentSpec,
        request,
        eventBus: new EventBus('exec-limit-4'),
        eventStore: new MemoryEventStore(),
        costCollector: createCostCollector(),
      })
    ).resolves.toMatchObject({
      runId: 'run-limit-3',
    });
  });

  it('maxActiveRuns 对 detached run 按执行终态释放名额，EventBus 提前 close 不会绕过上限', async () => {
    const registryStore = new MemoryRunRegistryStore();
    let releaseExecutor!: () => void;
    const executorCanFinish = new Promise<void>(resolve => {
      releaseExecutor = resolve;
    });
    const supervisor = new DefaultRunSupervisor({
      registryStore,
      executor: {
        execute: async context => {
          await executorCanFinish;
          return {
            runId: context.runId,
            status: 'completed',
            completedAt: 20,
          };
        },
      },
      maxActiveRuns: 1,
    });
    const firstBus = new EventBus('exec-detached-limit-1');
    const firstHandle = await supervisor.spawnDetached({
      runId: RunIdSchema.parse('detached-limit-1'),
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus: firstBus,
      eventStore: new MemoryEventStore(),
      costCollector: createCostCollector(),
    });

    firstBus.close();
    await expect(
      supervisor.spawnDetached({
        runId: RunIdSchema.parse('detached-limit-2'),
        conversationId: 'conv-2',
        agentSpec,
        request,
        eventBus: new EventBus('exec-detached-limit-2'),
        eventStore: new MemoryEventStore(),
        costCollector: createCostCollector(),
      })
    ).rejects.toBeInstanceOf(RunConcurrencyLimitExceededError);

    releaseExecutor();
    await expect(supervisor.waitForTerminal(firstHandle.runId)).resolves.toMatchObject({
      runId: 'detached-limit-1',
      status: 'completed',
    });

    await expect(
      supervisor.spawnDetached({
        runId: RunIdSchema.parse('detached-limit-3'),
        conversationId: 'conv-3',
        agentSpec,
        request,
        eventBus: new EventBus('exec-detached-limit-3'),
        eventStore: new MemoryEventStore(),
        costCollector: createCostCollector(),
      })
    ).resolves.toMatchObject({
      runId: 'detached-limit-3',
    });
  });

  it('spawnDetached executor 使用注册时快照，避免调用方后续修改请求对象影响后台 run', async () => {
    const registryStore = new MemoryRunRegistryStore();
    const mutableSpec: AgentSpec = {
      ...agentSpec,
      tools: [{ toolId: 'search' }],
    };
    const mutableRequest = {
      query: '原始后台任务',
      promptKey: 'default',
      nested: { phase: 'registered' },
    };
    const metadata = {
      traceId: 'trace-original',
      nested: { phase: 'registered' },
    };
    let releaseExecutor!: () => void;
    const executorCanFinish = new Promise<void>(resolve => {
      releaseExecutor = resolve;
    });
    const execute = vi.fn<RunExecutorPort<typeof mutableRequest>['execute']>(async context => {
      await executorCanFinish;
      return {
        runId: context.runId,
        status: 'completed',
        completedAt: 30,
        metadata: {
          observedRequest: context.request,
          observedAgentSpec: context.agentSpec,
          observedMetadata: context.metadata,
          observedConversationId: context.conversationId,
          observedParentRunId: context.parentRunId,
        },
      };
    });
    const supervisor = new DefaultRunSupervisor<typeof mutableRequest>({
      registryStore,
      executor: { execute },
      runIdFactory: () => RunIdSchema.parse('detached-snapshot'),
      now: () => 20,
    });

    const handle = await supervisor.spawnDetached({
      conversationId: 'conv-snapshot',
      parentRunId: RunIdSchema.parse('parent-snapshot'),
      agentSpec: mutableSpec,
      request: mutableRequest,
      eventBus: new EventBus('exec-snapshot'),
      eventStore: new MemoryEventStore(),
      costCollector: createCostCollector(),
      metadata,
    });

    mutableSpec.id = 'mutated-agent';
    mutableSpec.tools.push({ toolId: 'mutated-tool' });
    mutableRequest.query = '被调用方后续修改';
    mutableRequest.nested.phase = 'mutated';
    metadata.traceId = 'trace-mutated';
    metadata.nested.phase = 'mutated';

    releaseExecutor();
    const outcome = await supervisor.waitForTerminal(handle.runId);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'detached-snapshot',
        parentRunId: 'parent-snapshot',
        conversationId: 'conv-snapshot',
        agentSpec: expect.objectContaining({
          id: 'default_agent',
          tools: [{ toolId: 'search' }],
        }),
        request: {
          query: '原始后台任务',
          promptKey: 'default',
          nested: { phase: 'registered' },
        },
        metadata: {
          traceId: 'trace-original',
          nested: { phase: 'registered' },
        },
      })
    );
    expect(outcome.metadata).toMatchObject({
      observedConversationId: 'conv-snapshot',
      observedParentRunId: 'parent-snapshot',
      observedMetadata: {
        traceId: 'trace-original',
        nested: { phase: 'registered' },
      },
      observedRequest: {
        query: '原始后台任务',
        promptKey: 'default',
        nested: { phase: 'registered' },
      },
      observedAgentSpec: expect.objectContaining({
        id: 'default_agent',
        tools: [{ toolId: 'search' }],
      }),
    });
  });

  it('waitForTerminal 不会漏掉稍后完成的 detached run', async () => {
    const registryStore = new MemoryRunRegistryStore();
    let resolveOutcome: ((outcome: RunOutcome) => void) | undefined;
    const outcomePromise = new Promise<RunOutcome>(resolve => {
      resolveOutcome = resolve;
    });
    const supervisor = new DefaultRunSupervisor({
      registryStore,
      executor: { execute: () => outcomePromise },
      runIdFactory: () => RunIdSchema.parse('detached-wait'),
      now: () => 30,
    });

    const handle = await supervisor.spawnDetached({
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus: new EventBus('exec-wait'),
      eventStore: new MemoryEventStore(),
      costCollector: createCostCollector(),
    });
    const waitPromise = supervisor.waitForTerminal(handle.runId);

    resolveOutcome?.({
      runId: handle.runId,
      status: 'completed',
      completedAt: 40,
      currentNode: 'answer',
    });

    await expect(waitPromise).resolves.toMatchObject({
      runId: 'detached-wait',
      status: 'completed',
      currentNode: 'answer',
    });
  });

  it('findActiveByConversation 只返回指定会话的活跃顶层 run', async () => {
    const registryStore = new MemoryRunRegistryStore();
    const supervisor = new DefaultRunSupervisor({ registryStore });
    await supervisor.registerRun({
      runId: RunIdSchema.parse('root-active'),
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus: new EventBus('exec-root'),
      eventStore: new MemoryEventStore(),
      costCollector: createCostCollector(),
    });
    await supervisor.registerRun({
      runId: RunIdSchema.parse('child-active'),
      parentRunId: RunIdSchema.parse('root-active'),
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus: new EventBus('exec-child'),
      eventStore: new MemoryEventStore(),
      costCollector: createCostCollector(),
    });
    await supervisor.registerRun({
      runId: RunIdSchema.parse('other-conv'),
      conversationId: 'conv-2',
      agentSpec,
      request,
      eventBus: new EventBus('exec-other'),
      eventStore: new MemoryEventStore(),
      costCollector: createCostCollector(),
    });

    await expect(supervisor.findActiveByConversation('conv-1')).resolves.toEqual([
      expect.objectContaining({ runId: 'root-active', conversationId: 'conv-1' }),
    ]);
    const activeRunsWithChildren = await supervisor.findActiveByConversation('conv-1', {
      includeChildren: true,
    });
    expect(activeRunsWithChildren.map(run => run.runId).sort()).toEqual([
      'child-active',
      'root-active',
    ]);
    for (const run of activeRunsWithChildren) {
      expect(run.conversationId).toBe('conv-1');
    }
  });

  it('findByConversation 从持久 registry 返回指定会话的终态 metadata 快照', async () => {
    const registryStore = new MemoryRunRegistryStore();
    await registryStore.save({
      runId: RunIdSchema.parse('flow-terminal-root'),
      conversationId: 'conv-persistent-query',
      status: 'cancelled',
      startedAt: 10,
      updatedAt: 20,
      metadata: { originalSource: 'flow', lane: 'foreground' },
    });
    await registryStore.save({
      runId: RunIdSchema.parse('flow-terminal-child'),
      parentRunId: RunIdSchema.parse('flow-terminal-root'),
      conversationId: 'conv-persistent-query',
      status: 'cancelled',
      startedAt: 11,
      updatedAt: 21,
      metadata: { source: 'registered-child-run' },
    });
    await registryStore.save({
      runId: RunIdSchema.parse('other-terminal-root'),
      conversationId: 'conv-other',
      status: 'cancelled',
      startedAt: 12,
      updatedAt: 22,
      metadata: { originalSource: 'flow' },
    });
    const supervisor = new DefaultRunSupervisor({ registryStore });

    await expect(supervisor.findByConversation('conv-persistent-query')).resolves.toEqual([
      expect.objectContaining({
        runId: 'flow-terminal-root',
        conversationId: 'conv-persistent-query',
        status: 'cancelled',
        metadata: { originalSource: 'flow', lane: 'foreground' },
      }),
    ]);
    const withChildren = await supervisor.findByConversation('conv-persistent-query', {
      includeChildren: true,
      status: 'cancelled',
    });
    expect(withChildren.map(run => run.runId).sort()).toEqual([
      'flow-terminal-child',
      'flow-terminal-root',
    ]);
  });

  it('recoverOnBoot 把非终态 run 标记为 RUN_ABANDONED', async () => {
    const { registryStore, supervisor } = await registerOneRun();
    await supervisor.markAwaitingUser(RunIdSchema.parse('run-1'), {
      currentNode: 'wait_user',
      reason: '等待用户',
    });

    const outcomes = await supervisor.recoverOnBoot('进程重启');

    expect(outcomes).toEqual([
      expect.objectContaining({
        runId: 'run-1',
        status: 'failed',
        error: {
          errorCode: 'RUN_ABANDONED',
          message: '进程重启',
          recoverable: true,
        },
      }),
    ]);
    await expect(registryStore.load(RunIdSchema.parse('run-1'))).resolves.toMatchObject({
      status: 'failed',
      errorIfAny: {
        errorCode: 'RUN_ABANDONED',
        message: '进程重启',
        recoverable: true,
      },
    });
  });

  it('recoverOnBoot 在写回状态前读取完 registry 的全部分页', async () => {
    class TwoItemPageRegistryStore extends MemoryRunRegistryStore {
      override async list(filter: ListRunsFilter = {}) {
        return super.list({ ...filter, limit: Math.min(filter.limit ?? 2, 2) });
      }
    }

    const registryStore = new TwoItemPageRegistryStore();
    for (let index = 0; index < 5; index += 1) {
      await registryStore.save({
        runId: RunIdSchema.parse(`stale-${index}`),
        conversationId: 'conv-paged-recovery',
        status: 'running',
        startedAt: index,
        updatedAt: index,
      });
    }
    const supervisor = new DefaultRunSupervisor({ registryStore });

    const outcomes = await supervisor.recoverOnBoot('paged recovery');

    expect(outcomes.map(outcome => outcome.runId).sort()).toEqual([
      'stale-0',
      'stale-1',
      'stale-2',
      'stale-3',
      'stale-4',
    ]);
  });

  it('drain 等待所有 in-flight detached run 进入终态', async () => {
    const registryStore = new MemoryRunRegistryStore();
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    const executor: RunExecutorPort = {
      async execute(context) {
        await new Promise<void>(resolve => {
          if (context.runId === 'run-a') {
            releaseFirst = resolve;
          } else {
            releaseSecond = resolve;
          }
        });
        return {
          runId: context.runId,
          status: 'completed',
          completedAt: 50,
        };
      },
    };
    let idCounter = 0;
    const supervisor = new DefaultRunSupervisor({
      registryStore,
      executor,
      runIdFactory: () => RunIdSchema.parse(idCounter++ === 0 ? 'run-a' : 'run-b'),
      now: () => 50,
    });

    await supervisor.spawnDetached({
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus: new EventBus('exec-a'),
      eventStore: new MemoryEventStore(),
      costCollector: createCostCollector(),
    });
    await supervisor.spawnDetached({
      conversationId: 'conv-1',
      agentSpec,
      request,
      eventBus: new EventBus('exec-b'),
      eventStore: new MemoryEventStore(),
      costCollector: createCostCollector(),
    });
    const drainPromise = supervisor.drain();

    await nextTask();
    releaseFirst?.();
    releaseSecond?.();

    await expect(drainPromise).resolves.toEqual([
      expect.objectContaining({ runId: 'run-a', status: 'completed' }),
      expect.objectContaining({ runId: 'run-b', status: 'completed' }),
    ]);
  });
});
