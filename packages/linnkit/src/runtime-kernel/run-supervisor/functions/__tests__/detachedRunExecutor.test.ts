import { describe, expect, it, vi } from 'vitest';

import type { AgentSpec } from '../../../../contracts';
import type { RuntimeEvent } from '../../../../contracts';
import { EventBus } from '../../../execution/event-bus';
import { MemoryEventStore } from '../../../graph-engine/event-store/memoryEventStore';
import { MemoryRunRegistryStore } from '../../memoryRunRegistryStore';
import type { RunHandle, RunMeta, RunRequestSnapshot } from '../../runHandle';
import type { RunRegistrationSpec } from '../../definitions/runSupervisorContracts';
import { createDetachedRunExecutor } from '../detachedRunExecutor';
import { RunIdSchema } from '../../../../contracts';

const agentSpec: AgentSpec = {
  id: 'agent-1',
  version: '1.0.0',
  capabilities: ['chat'],
  tools: [],
  contextPolicy: { profileId: 'agent' },
};

const request = {
  query: 'hello',
  promptKey: 'default',
} satisfies RunRequestSnapshot;

function createCostCollector() {
  return {
    snapshot: () => ({ tokensInput: 1, tokensOutput: 2 }),
  };
}

function createSpec(): RunRegistrationSpec<typeof request> {
  return {
    conversationId: 'conv-1',
    agentSpec,
    request,
    eventBus: new EventBus('exec-1'),
    eventStore: new MemoryEventStore(),
    costCollector: createCostCollector(),
    metadata: {
      traceId: 'trace-1',
    },
  };
}

function createHandle(
  registryStore: MemoryRunRegistryStore,
  overrides: Partial<RunHandle<typeof request>> = {}
): RunHandle<typeof request> {
  const meta: RunMeta = {
    runId: RunIdSchema.parse('run-1'),
    conversationId: 'conv-1',
    agentSpecId: 'agent-1',
    status: 'pending',
    startedAt: 10,
    updatedAt: 10,
  };
  const controller = new AbortController();
  const markRunning = vi.fn(
    async (patch?: Parameters<RunHandle<typeof request>['markRunning']>[0]) => {
      const record = await registryStore.load(RunIdSchema.parse('run-1'));
      if (!record) {
        return;
      }
      await registryStore.save({
        ...record,
        status: 'running',
        currentNode: patch?.currentNode,
        updatedAt: 20,
      });
    }
  );
  const markCompleted = vi.fn(
    async (patch?: Parameters<RunHandle<typeof request>['markCompleted']>[0]) => {
      const record = await registryStore.load(RunIdSchema.parse('run-1'));
      if (!record) {
        return;
      }
      await registryStore.save({
        ...record,
        status: 'completed',
        currentNode: patch?.currentNode,
        iterationsUsed: patch?.iterationsUsed,
        updatedAt: 30,
      });
    }
  );
  const markFailed = vi.fn(
    async (
      error: Parameters<RunHandle<typeof request>['markFailed']>[0],
      patch?: Parameters<RunHandle<typeof request>['markFailed']>[1]
    ) => {
      const record = await registryStore.load(RunIdSchema.parse('run-1'));
      if (!record) {
        return;
      }
      await registryStore.save({
        ...record,
        status: 'failed',
        currentNode: patch?.currentNode,
        iterationsUsed: patch?.iterationsUsed,
        errorIfAny: error,
        updatedAt: 30,
      });
    }
  );
  const cancel = vi.fn(
    async (
      opts: Parameters<RunHandle<typeof request>['cancel']>[0],
      patch?: Parameters<RunHandle<typeof request>['cancel']>[1]
    ) => {
      const record = await registryStore.load(RunIdSchema.parse('run-1'));
      if (!record) {
        return;
      }
      await registryStore.save({
        ...record,
        status: 'cancelled',
        currentNode: patch?.currentNode,
        iterationsUsed: patch?.iterationsUsed,
        errorIfAny: {
          errorCode: 'RUN_CANCELLED',
          message: opts.reason,
          recoverable: false,
        },
        updatedAt: 30,
      });
    }
  );
  async function* observe(): AsyncIterable<RuntimeEvent> {
    for (const event of [] as RuntimeEvent[]) {
      yield event;
    }
  }
  return {
    runId: RunIdSchema.parse('run-1'),
    parentRunId: undefined,
    signal: controller.signal,
    spec: vi.fn(async () => agentSpec),
    request: vi.fn(async () => request),
    attachTransportEventBus: vi.fn(),
    meta: vi.fn(async () => meta),
    observe,
    cancel,
    markRunning,
    markAwaitingUser: vi.fn(async () => undefined),
    markCompleted,
    markFailed,
    cost: vi.fn(async () => ({ tokensInput: 0, tokensOutput: 0 })),
    pause: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    resume: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    ...overrides,
  };
}

describe('detachedRunExecutor', () => {
  it('执行成功时标记 completed、合并 executor metadata 并通知终态', async () => {
    const registryStore = new MemoryRunRegistryStore();
    await registryStore.save({
      runId: RunIdSchema.parse('run-1'),
      conversationId: 'conv-1',
      agentSpecId: 'agent-1',
      status: 'pending',
      startedAt: 10,
      updatedAt: 10,
      metadata: {
        traceId: 'trace-1',
      },
    });
    const handle = createHandle(registryStore);
    const notifyTerminal = vi.fn();
    const cleanupRunResources = vi.fn();
    const detached = createDetachedRunExecutor({
      registryStore,
      now: () => 99,
      notifyTerminal,
      cleanupRunResources,
      executor: {
        execute: async () => ({
          runId: RunIdSchema.parse('run-1'),
          status: 'completed',
          completedAt: 30,
          currentNode: 'answer',
          iterationsUsed: 3,
          metadata: {
            source: 'executor',
          },
        }),
      },
    });

    const outcome = await detached.executeDetachedRun(handle, createSpec());

    expect(handle.markRunning).toHaveBeenCalledWith({ currentNode: 'detached' });
    expect(handle.markCompleted).toHaveBeenCalledWith({
      currentNode: 'answer',
      iterationsUsed: 3,
    });
    expect(outcome).toMatchObject({
      runId: 'run-1',
      status: 'completed',
      currentNode: 'answer',
      iterationsUsed: 3,
      metadata: {
        traceId: 'trace-1',
        source: 'executor',
      },
    });
    expect(notifyTerminal).toHaveBeenCalledWith(outcome);
    expect(cleanupRunResources).toHaveBeenCalledWith('run-1');
    await expect(registryStore.load(RunIdSchema.parse('run-1'))).resolves.toMatchObject({
      metadata: {
        traceId: 'trace-1',
        source: 'executor',
      },
    });
  });

  it('executor 抛错时标记 failed 并仍通知和清理', async () => {
    const registryStore = new MemoryRunRegistryStore();
    await registryStore.save({
      runId: RunIdSchema.parse('run-1'),
      conversationId: 'conv-1',
      agentSpecId: 'agent-1',
      status: 'running',
      startedAt: 10,
      updatedAt: 10,
    });
    const handle = createHandle(registryStore);
    const notifyTerminal = vi.fn();
    const cleanupRunResources = vi.fn();
    const detached = createDetachedRunExecutor({
      registryStore,
      now: () => 99,
      notifyTerminal,
      cleanupRunResources,
      executor: {
        execute: async () => {
          throw new Error('boom');
        },
      },
    });

    const outcome = await detached.executeDetachedRun(handle, createSpec());

    expect(handle.markFailed).toHaveBeenCalledWith({
      errorCode: 'RUN_FAILED',
      message: 'boom',
      recoverable: false,
    });
    expect(outcome).toMatchObject({
      runId: 'run-1',
      status: 'failed',
      error: {
        errorCode: 'RUN_FAILED',
      },
    });
    expect(notifyTerminal).toHaveBeenCalledWith(outcome);
    expect(cleanupRunResources).toHaveBeenCalledWith('run-1');
  });

  it('executor 返回 cancelled 时把真实节点和迭代数写入取消终态', async () => {
    const registryStore = new MemoryRunRegistryStore();
    await registryStore.save({
      runId: RunIdSchema.parse('run-1'),
      conversationId: 'conv-1',
      agentSpecId: 'agent-1',
      status: 'running',
      startedAt: 10,
      updatedAt: 10,
    });
    const handle = createHandle(registryStore);
    const detached = createDetachedRunExecutor({
      registryStore,
      now: () => 99,
      notifyTerminal: vi.fn(),
      cleanupRunResources: vi.fn(),
      executor: {
        execute: async () => ({
          runId: RunIdSchema.parse('run-1'),
          status: 'cancelled',
          completedAt: 30,
          currentNode: 'tool',
          iterationsUsed: 6,
          error: {
            errorCode: 'RUN_CANCELLED',
            message: 'detached cancelled',
            recoverable: false,
          },
        }),
      },
    });

    const outcome = await detached.executeDetachedRun(handle, createSpec());

    expect(handle.cancel).toHaveBeenCalledWith(
      {
        reason: 'detached cancelled',
        forceCleanup: true,
      },
      {
        currentNode: 'tool',
        iterationsUsed: 6,
      }
    );
    expect(outcome).toMatchObject({
      status: 'cancelled',
      currentNode: 'tool',
      iterationsUsed: 6,
    });
  });
});
