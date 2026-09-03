import { describe, expect, it, vi } from 'vitest';
import type { AgentSpec } from '@linnlabs/linnkit/contracts';
import { execution, graph, runSupervisor } from '@linnlabs/linnkit/runtime-kernel';

import { cancelActiveRunsForPluginRuntimeChange } from '../pluginRuntimeRunInvalidation';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';

const agentSpec: AgentSpec = {
  id: 'test-agent',
  version: '1.0.0',
  capabilities: ['chat'],
  tools: [],
  contextPolicy: { profileId: 'agent' },
};

const request = {
  promptKey: 'default',
  query: 'hello',
} satisfies runSupervisor.RunRequestSnapshot;
const PLUGIN_ID = 'runtime-change-fixture';

const costCollector: runSupervisor.RunCostCollector = {
  snapshot: () => ({
    tokensInput: 0,
    tokensOutput: 0,
  }),
};

function createEventBus(runId: string): execution.EventBus {
  return new execution.EventBus(`exec-${runId}`);
}

function sortRunIds(ids: readonly string[]): readonly string[] {
  return [...ids].sort();
}

async function registerRun(
  supervisor: runSupervisor.DefaultRunSupervisor,
  params: {
    runId: string;
    status: 'pending' | 'running' | 'awaiting_user' | 'completed';
    parentRunId?: string;
  }
): Promise<void> {
  const handle = await supervisor.registerRun({
    runId: RunIdSchema.parse(params.runId),
    parentRunId:
      params.parentRunId === undefined ? undefined : RunIdSchema.parse(params.parentRunId),
    conversationId: 'conv-1',
    agentSpec,
    request,
    eventBus: createEventBus(params.runId),
    eventStore: new graph.MemoryEventStore(),
    costCollector,
  });

  if (params.status === 'running') {
    await handle.markRunning();
  } else if (params.status === 'awaiting_user') {
    await handle.markAwaitingUser({ reason: 'needs user' });
  } else if (params.status === 'completed') {
    await handle.markCompleted();
  }
}

describe('cancelActiveRunsForPluginRuntimeChange', () => {
  it('cancels active top-level and child runs when plugin runtime changes', async () => {
    const supervisor = new runSupervisor.DefaultRunSupervisor({
      registryStore: new runSupervisor.MemoryRunRegistryStore(),
    });
    await registerRun(supervisor, { runId: 'run-pending', status: 'pending' });
    await registerRun(supervisor, { runId: 'run-running', status: 'running' });
    await registerRun(supervisor, { runId: 'run-awaiting', status: 'awaiting_user' });
    await registerRun(supervisor, {
      runId: 'run-child',
      status: 'running',
      parentRunId: 'run-running',
    });
    await registerRun(supervisor, { runId: 'run-completed', status: 'completed' });

    const result = await cancelActiveRunsForPluginRuntimeChange({
      pluginId: PLUGIN_ID,
      operation: '禁用',
      supervisor,
    });

    expect(result.failedRunIds).toEqual([]);
    expect(sortRunIds(result.cancelledRunIds)).toEqual([
      'run-awaiting',
      'run-child',
      'run-pending',
      'run-running',
    ]);
    await expect(supervisor.peek(RunIdSchema.parse('run-running'))).resolves.toMatchObject({
      status: 'cancelled',
      errorIfAny: expect.objectContaining({
        errorCode: 'RUN_CANCELLED',
        message: expect.stringContaining(`插件 ${PLUGIN_ID} 正在执行 禁用`),
      }),
    });
    await expect(supervisor.peek(RunIdSchema.parse('run-completed'))).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it('continues cancelling remaining runs when one cancel call fails', async () => {
    const cancel = vi.fn(async (runId: string) => {
      if (runId === 'run-1') {
        throw new Error('cancel failed');
      }
    });
    const supervisor: Pick<runSupervisor.RunSupervisor, 'list' | 'cancel'> = {
      list: async () => ({
        runs: [
          {
            runId: RunIdSchema.parse('run-1'),
            conversationId: 'conv-1',
            status: 'running',
            startedAt: 1,
            updatedAt: 1,
          },
          {
            runId: RunIdSchema.parse('run-2'),
            conversationId: 'conv-1',
            status: 'pending',
            startedAt: 2,
            updatedAt: 2,
          },
        ],
      }),
      cancel,
    };

    const result = await cancelActiveRunsForPluginRuntimeChange({
      pluginId: PLUGIN_ID,
      operation: '卸载',
      supervisor,
    });

    expect(result).toEqual({
      cancelledRunIds: ['run-2'],
      failedRunIds: ['run-1'],
    });
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledWith(
      'run-2',
      expect.objectContaining({
        forceCleanup: true,
        reason: expect.stringContaining(`插件 ${PLUGIN_ID} 正在执行 卸载`),
      })
    );
  });
});
