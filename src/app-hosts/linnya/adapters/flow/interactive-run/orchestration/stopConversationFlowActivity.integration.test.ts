import Database from 'better-sqlite3';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentSpec } from '@linnlabs/linnkit/contracts';
import { RunIdSchema, type RunId } from '@linnlabs/linnkit/contracts';
import { execution, graph, runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { SQLiteRunRegistryStore } from 'src/app-hosts/linnya/adapters/persistence/run-registry';

import { createFlowExecutionCompletionRegistry } from './flowExecutionCompletionRegistry';
import {
  FlowConversationActivityStopError,
  stopConversationFlowActivity,
  stopFlowRunAndWait,
} from './stopConversationFlowActivity';

const AGENT_SPEC: AgentSpec = {
  id: 'flow-activity-test-agent',
  version: '1.0.0',
  role: 'agent',
  capabilities: ['agent'],
  tools: [],
  contextPolicy: { profileId: 'agent' },
};

function createLatch(): { readonly promise: Promise<void>; release(): void } {
  let release = (): void => undefined;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

function createRuntime(
  registryStore: runSupervisor.RunRegistryStore = new runSupervisor.MemoryRunRegistryStore()
) {
  const supervisor = new runSupervisor.DefaultRunSupervisor({
    registryStore,
  });
  const executionCompletions = createFlowExecutionCompletionRegistry();
  const discardCheckpoint = vi.fn(async (_runId: RunId): Promise<void> => undefined);
  const releaseCost = vi.fn((_runId: RunId): void => undefined);
  return {
    supervisor,
    executionCompletions,
    discardCheckpoint,
    releaseCost,
  };
}

function createPersistentRegistry(conversationId: string, databasePath = ':memory:'): {
  readonly db: Database.Database;
  readonly registryStore: SQLiteRunRegistryStore;
} {
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE assets (id TEXT PRIMARY KEY);
  `);
  for (const schema of CONVERSATION_SCHEMAS) {
    db.exec(schema);
  }
  db.prepare(
    `
    INSERT INTO conversations (conversation_id, title, created_at, last_event_at)
    VALUES (?, 'flow cleanup retry', 1, 1)
  `
  ).run(conversationId);
  return { db, registryStore: new SQLiteRunRegistryStore(db) };
}

async function registerRun(input: {
  readonly supervisor: runSupervisor.DefaultRunSupervisor;
  readonly conversationId: string;
  readonly runId: string;
  readonly parentRunId?: RunId;
  readonly parentSignal?: AbortSignal;
  readonly lane?: 'foreground' | 'auxiliary';
  readonly source?: 'flow' | 'registered-child-run';
}) {
  const runId = RunIdSchema.parse(input.runId);
  const eventBus = new execution.EventBus(`execution:${runId}`);
  const handle = await input.supervisor.registerRun({
    runId,
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    ...(input.parentSignal ? { parentSignal: input.parentSignal } : {}),
    conversationId: input.conversationId,
    agentSpec: AGENT_SPEC,
    request: { query: runId },
    eventBus,
    eventStore: new graph.MemoryEventStore(),
    costCollector: {
      snapshot: () => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 }),
    },
    metadata:
      input.source === 'registered-child-run'
        ? { source: 'registered-child-run' }
        : { originalSource: 'flow', lane: input.lane ?? 'foreground' },
  });
  await handle.markRunning({ currentNode: 'llm' });
  return { eventBus, handle, runId };
}

describe('stopFlowRunAndWait', () => {
  it('取消 active root 后等待 Host completion，并返回真实 cancelled 终态', async () => {
    const conversationId = 'conversation-single-run-cancelled';
    const runtime = createRuntime();
    const flow = await registerRun({
      supervisor: runtime.supervisor,
      conversationId,
      runId: 'run-single-run-cancelled',
    });
    const completion = runtime.executionCompletions.register(flow.runId, conversationId);

    let settled = false;
    const stopping = stopFlowRunAndWait({
      runId: flow.runId,
      conversationId,
      reason: 'user cancelled',
      runtime,
    }).then(result => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(flow.handle.signal.aborted).toBe(true));
    expect(settled).toBe(false);

    completion.complete();
    await expect(stopping).resolves.toEqual({
      outcome: 'cancelled',
      terminalStatus: 'cancelled',
    });
    expect(runtime.discardCheckpoint).toHaveBeenCalledWith(flow.runId);
    expect(runtime.releaseCost).toHaveBeenCalledWith(flow.runId);
    flow.eventBus.close();
  });

  it('run 已自然完成时把取消视为终态竞争，不再要求 active owner', async () => {
    const conversationId = 'conversation-single-run-completed';
    const runtime = createRuntime();
    const flow = await registerRun({
      supervisor: runtime.supervisor,
      conversationId,
      runId: 'run-single-run-completed',
    });
    await flow.handle.markCompleted({ currentNode: 'answer' });

    await expect(stopFlowRunAndWait({
      runId: flow.runId,
      conversationId,
      reason: 'user cancelled after final answer',
      runtime,
    })).resolves.toEqual({
      outcome: 'already_terminal',
      terminalStatus: 'completed',
    });

    expect(runtime.discardCheckpoint).not.toHaveBeenCalled();
    expect(runtime.releaseCost).not.toHaveBeenCalled();
    flow.eventBus.close();
  });

  it('cancel 调用期间自然完成时返回 completed，且不重复清理已结算资源', async () => {
    const conversationId = 'conversation-single-run-race';
    const runtime = createRuntime();
    const flow = await registerRun({
      supervisor: runtime.supervisor,
      conversationId,
      runId: 'run-single-run-race',
    });
    const completion = runtime.executionCompletions.register(flow.runId, conversationId);
    const supervisor = runtime.supervisor;
    const racedRuntime = {
      ...runtime,
      supervisor: {
        cancel: async (): Promise<void> => {
          await flow.handle.markCompleted({ currentNode: 'answer' });
          throw new runSupervisor.RunNotFoundError(flow.runId);
        },
        findActiveByConversation: supervisor.findActiveByConversation.bind(supervisor),
        findByConversation: supervisor.findByConversation.bind(supervisor),
        peek: supervisor.peek.bind(supervisor),
      },
    };

    const stopping = stopFlowRunAndWait({
      runId: flow.runId,
      conversationId,
      reason: 'user cancelled at completion boundary',
      runtime: racedRuntime,
    });
    completion.complete();

    await expect(stopping).resolves.toEqual({
      outcome: 'already_terminal',
      terminalStatus: 'completed',
    });
    expect(runtime.discardCheckpoint).not.toHaveBeenCalled();
    expect(runtime.releaseCost).not.toHaveBeenCalled();
    flow.eventBus.close();
  });
});

describe('stopConversationFlowActivity', () => {
  it('取消同一对话全部 foreground/auxiliary root，并等待每个 Host completion 后再返回', async () => {
    const conversationId = 'conversation-flow-stop-many';
    const runtime = createRuntime();
    const foreground = await registerRun({
      supervisor: runtime.supervisor,
      conversationId,
      runId: 'run-flow-foreground',
      lane: 'foreground',
    });
    const auxiliary = await registerRun({
      supervisor: runtime.supervisor,
      conversationId,
      runId: 'run-flow-auxiliary',
      lane: 'auxiliary',
    });
    const foregroundCompletion = runtime.executionCompletions.register(
      foreground.runId,
      conversationId
    );
    const auxiliaryCompletion = runtime.executionCompletions.register(
      auxiliary.runId,
      conversationId
    );

    let settled = false;
    const stopping = stopConversationFlowActivity({ conversationId, runtime }).then(() => {
      settled = true;
    });
    await vi.waitFor(() => {
      expect(foreground.handle.signal.aborted).toBe(true);
      expect(auxiliary.handle.signal.aborted).toBe(true);
    });
    expect(settled).toBe(false);

    foregroundCompletion.complete();
    await Promise.resolve();
    expect(settled).toBe(false);
    auxiliaryCompletion.complete();
    await stopping;

    expect(runtime.discardCheckpoint.mock.calls.map(([runId]) => runId)).toEqual(
      expect.arrayContaining([foreground.runId, auxiliary.runId])
    );
    expect(runtime.releaseCost.mock.calls.map(([runId]) => runId)).toEqual(
      expect.arrayContaining([foreground.runId, auxiliary.runId])
    );
    await expect(runtime.supervisor.findActiveByConversation(conversationId)).resolves.toEqual([]);
    foreground.eventBus.close();
    auxiliary.eventBus.close();
  });

  it('纯 awaiting_user 没有 transport completion 时取消 run 并清理 checkpoint/cost', async () => {
    const conversationId = 'conversation-flow-awaiting-user';
    const runtime = createRuntime();
    const awaiting = await registerRun({
      supervisor: runtime.supervisor,
      conversationId,
      runId: 'run-flow-awaiting-user',
    });
    await awaiting.handle.markAwaitingUser({ currentNode: 'wait_user' });

    await stopConversationFlowActivity({ conversationId, runtime });

    expect(awaiting.handle.signal.aborted).toBe(true);
    expect(runtime.discardCheckpoint).toHaveBeenCalledWith(awaiting.runId);
    expect(runtime.releaseCost).toHaveBeenCalledWith(awaiting.runId);
    await expect(runtime.supervisor.findActiveByConversation(conversationId)).resolves.toEqual([]);
    awaiting.eventBus.close();
  });

  it('Supervisor 已先写取消终态时仍等待按对话捕获的 Host completion', async () => {
    const conversationId = 'conversation-flow-terminal-before-finalize';
    const runtime = createRuntime();
    const flow = await registerRun({
      supervisor: runtime.supervisor,
      conversationId,
      runId: 'run-flow-terminal-before-finalize',
    });
    const completion = runtime.executionCompletions.register(flow.runId, conversationId);
    await flow.handle.cancel({ reason: 'external owner cancelled', forceCleanup: false });
    await expect(runtime.supervisor.findActiveByConversation(conversationId)).resolves.toEqual([]);

    let settled = false;
    const stopping = stopConversationFlowActivity({ conversationId, runtime }).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    completion.complete();
    await stopping;
    expect(runtime.discardCheckpoint).toHaveBeenCalledWith(flow.runId);
    expect(runtime.releaseCost).toHaveBeenCalledWith(flow.runId);
    flow.eventBus.close();
  });

  it('completed 已证明 checkpoint 清理完成，只等待仍在途的 Host completion', async () => {
    const conversationId = 'conversation-flow-completed-before-finalize';
    const runtime = createRuntime();
    const flow = await registerRun({
      supervisor: runtime.supervisor,
      conversationId,
      runId: 'run-flow-completed-before-finalize',
    });
    const completion = runtime.executionCompletions.register(flow.runId, conversationId);
    await flow.handle.markCompleted({ currentNode: 'answer' });

    let settled = false;
    const stopping = stopConversationFlowActivity({ conversationId, runtime }).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    completion.complete();
    await stopping;
    expect(runtime.discardCheckpoint).not.toHaveBeenCalled();
    expect(runtime.releaseCost).not.toHaveBeenCalled();
    flow.eventBus.close();
  });

  it('Host completion 成功也不会吞掉普通 cancel 错误', async () => {
    const conversationId = 'conversation-flow-cancel-failed';
    const runtime = createRuntime();
    const flow = await registerRun({
      supervisor: runtime.supervisor,
      conversationId,
      runId: 'run-flow-cancel-failed',
    });
    const completion = runtime.executionCompletions.register(flow.runId, conversationId);
    const cancelError = new Error('run registry write failed');
    const supervisor = runtime.supervisor;
    const failingRuntime = {
      ...runtime,
      supervisor: {
        cancel: async (): Promise<void> => {
          throw cancelError;
        },
        findActiveByConversation: supervisor.findActiveByConversation.bind(supervisor),
        findByConversation: supervisor.findByConversation.bind(supervisor),
        peek: supervisor.peek.bind(supervisor),
      },
    };

    const stopping = stopConversationFlowActivity({
      conversationId,
      runtime: failingRuntime,
    });
    const assertion = expect(stopping).rejects.toMatchObject({
      name: 'FlowConversationActivityStopError',
      failures: [
        expect.objectContaining({
          runId: flow.runId,
          stage: 'cancel_run',
          error: cancelError,
        }),
      ],
    } satisfies Partial<FlowConversationActivityStopError>);
    completion.complete();
    await assertion;

    expect(runtime.discardCheckpoint).not.toHaveBeenCalled();
    expect(flow.handle.signal.aborted).toBe(false);
    await flow.handle.cancel({ reason: 'test teardown', forceCleanup: true });
    flow.eventBus.close();
  });

  it('Host completion 成功时只忽略明确的 RunNotFoundError 竞态', async () => {
    const conversationId = 'conversation-flow-natural-completion-race';
    const runtime = createRuntime();
    const flow = await registerRun({
      supervisor: runtime.supervisor,
      conversationId,
      runId: 'run-flow-natural-completion-race',
    });
    const completion = runtime.executionCompletions.register(flow.runId, conversationId);
    const supervisor = runtime.supervisor;
    const racedRuntime = {
      ...runtime,
      supervisor: {
        cancel: async (): Promise<void> => {
          await flow.handle.markCompleted({ currentNode: 'answer' });
          throw new runSupervisor.RunNotFoundError(flow.runId);
        },
        findActiveByConversation: supervisor.findActiveByConversation.bind(supervisor),
        findByConversation: supervisor.findByConversation.bind(supervisor),
        peek: supervisor.peek.bind(supervisor),
      },
    };

    const stopping = stopConversationFlowActivity({ conversationId, runtime: racedRuntime });
    completion.complete();
    await stopping;

    expect(runtime.discardCheckpoint).not.toHaveBeenCalled();
    expect(runtime.releaseCost).not.toHaveBeenCalled();
    flow.eventBus.close();
  });

  it('checkpoint 首次清理失败后，重建 Supervisor 仍由持久 run 重新发现并重试', async () => {
    const conversationId = 'conversation-flow-checkpoint-retry';
    const temporaryRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'linnya-flow-cleanup-retry-')
    );
    const databasePath = path.join(temporaryRoot, 'runtime.sqlite');
    const firstOwner = createPersistentRegistry(conversationId, databasePath);
    let restartedDb: Database.Database | undefined;
    try {
      const runtime = createRuntime(firstOwner.registryStore);
      const awaiting = await registerRun({
        supervisor: runtime.supervisor,
        conversationId,
        runId: 'run-flow-checkpoint-retry',
      });
      await awaiting.handle.markAwaitingUser({ currentNode: 'wait_user' });
      const checkpointError = new Error('checkpoint database unavailable');
      runtime.discardCheckpoint.mockRejectedValueOnce(checkpointError);

      await expect(
        stopConversationFlowActivity({ conversationId, runtime })
      ).rejects.toMatchObject({
        name: 'FlowConversationActivityStopError',
        failures: [
          expect.objectContaining({
            runId: awaiting.runId,
            stage: 'discard_checkpoint',
            error: checkpointError,
          }),
        ],
      } satisfies Partial<FlowConversationActivityStopError>);
      expect(runtime.releaseCost).not.toHaveBeenCalled();
      awaiting.eventBus.close();
      firstOwner.db.close();

      restartedDb = new Database(databasePath);
      const restartedRuntime = createRuntime(new SQLiteRunRegistryStore(restartedDb));
      await stopConversationFlowActivity({ conversationId, runtime: restartedRuntime });

      expect(restartedRuntime.discardCheckpoint).toHaveBeenCalledWith(awaiting.runId);
      expect(restartedRuntime.releaseCost).toHaveBeenCalledWith(awaiting.runId);
    } finally {
      if (firstOwner.db.open) firstOwner.db.close();
      if (restartedDb?.open) restartedDb.close();
      await fsp.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('cost 首次释放失败后，下次重放从 checkpoint 清理开始幂等重试', async () => {
    const conversationId = 'conversation-flow-cost-retry';
    const runtime = createRuntime();
    const awaiting = await registerRun({
      supervisor: runtime.supervisor,
      conversationId,
      runId: 'run-flow-cost-retry',
    });
    await awaiting.handle.markAwaitingUser({ currentNode: 'wait_user' });
    const releaseError = new Error('cost collector release failed');
    runtime.releaseCost.mockImplementationOnce(() => {
      throw releaseError;
    });

    await expect(stopConversationFlowActivity({ conversationId, runtime })).rejects.toMatchObject({
      name: 'FlowConversationActivityStopError',
      failures: [
        expect.objectContaining({
          runId: awaiting.runId,
          stage: 'release_cost',
          error: releaseError,
        }),
      ],
    } satisfies Partial<FlowConversationActivityStopError>);

    await stopConversationFlowActivity({ conversationId, runtime });
    expect(runtime.discardCheckpoint).toHaveBeenCalledTimes(2);
    expect(runtime.releaseCost).toHaveBeenCalledTimes(2);
    awaiting.eventBus.close();
  });

  it('Supervisor 异步查询期间登记的 resume completion 由第二次快照捕获', async () => {
    const conversationId = 'conversation-flow-resume-snapshot-race';
    const runtime = createRuntime();
    const flow = await registerRun({
      supervisor: runtime.supervisor,
      conversationId,
      runId: 'run-flow-resume-snapshot-race',
    });
    const queryStarted = createLatch();
    const continueQuery = createLatch();
    const supervisor = runtime.supervisor;
    const raceRuntime = {
      ...runtime,
      supervisor: {
        cancel: supervisor.cancel.bind(supervisor),
        findActiveByConversation: supervisor.findActiveByConversation.bind(supervisor),
        findByConversation: async (
          targetConversationId: string,
          options?: runSupervisor.FindRunsByConversationOptions
        ) => {
          queryStarted.release();
          await continueQuery.promise;
          return supervisor.findByConversation(targetConversationId, options);
        },
        peek: supervisor.peek.bind(supervisor),
      },
    };

    let settled = false;
    const stopping = stopConversationFlowActivity({
      conversationId,
      runtime: raceRuntime,
    }).then(() => {
      settled = true;
    });
    await queryStarted.promise;
    const completion = runtime.executionCompletions.register(flow.runId, conversationId);
    continueQuery.release();
    await vi.waitFor(() => expect(flow.handle.signal.aborted).toBe(true));
    expect(settled).toBe(false);

    completion.complete();
    await stopping;
    flow.eventBus.close();
  });

  it('父 Flow completion 结束后仍有 registered child 时失败并保留删除屏障', async () => {
    const conversationId = 'conversation-flow-orphan-child';
    const runtime = createRuntime();
    const parent = await registerRun({
      supervisor: runtime.supervisor,
      conversationId,
      runId: 'run-flow-parent',
    });
    const child = await registerRun({
      supervisor: runtime.supervisor,
      conversationId,
      runId: 'run-flow-child',
      parentRunId: parent.runId,
      parentSignal: parent.handle.signal,
      source: 'registered-child-run',
    });
    const completion = runtime.executionCompletions.register(parent.runId, conversationId);

    const stopping = stopConversationFlowActivity({ conversationId, runtime });
    await vi.waitFor(() => expect(parent.handle.signal.aborted).toBe(true));
    expect(child.handle.signal.aborted).toBe(true);
    completion.complete();

    await expect(stopping).rejects.toMatchObject({
      name: 'FlowConversationActivityStopError',
      failures: [
        expect.objectContaining({
          runId: child.runId,
          stage: 'active_child_after_root_settlement',
        }),
      ],
    } satisfies Partial<FlowConversationActivityStopError>);

    await child.handle.cancel({ reason: 'test teardown', forceCleanup: true });
    parent.eventBus.close();
    child.eventBus.close();
  });

  it('活跃 Flow 缺失 Host completion 时不先取消，持续保留删除屏障', async () => {
    const conversationId = 'conversation-flow-missing-completion';
    const runtime = createRuntime();
    const flow = await registerRun({
      supervisor: runtime.supervisor,
      conversationId,
      runId: 'run-flow-missing-completion',
    });

    await expect(stopConversationFlowActivity({ conversationId, runtime })).rejects.toMatchObject({
      name: 'FlowConversationActivityStopError',
      failures: [
        expect.objectContaining({
          runId: flow.runId,
          stage: 'missing_execution_completion',
        }),
      ],
    } satisfies Partial<FlowConversationActivityStopError>);
    expect(flow.handle.signal.aborted).toBe(false);
    expect(runtime.discardCheckpoint).not.toHaveBeenCalled();
    await flow.handle.cancel({ reason: 'test teardown', forceCleanup: true });
    flow.eventBus.close();
  });
});
