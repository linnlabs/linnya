import { describe, expect, it, vi } from 'vitest';

import { RunNotFoundError } from '../../runErrors';
import type { RunRecord } from '../../runRegistryStorePort';
import { createTerminalWaiterRegistry } from '../terminalWaiterRegistry';
import { RunIdSchema } from '../../../../contracts';

async function nextTask(): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });
}

function createRecord(runId: string, status: RunRecord['status'] = 'running'): RunRecord {
  return {
    runId: RunIdSchema.parse(runId),
    conversationId: 'conv-1',
    agentSpecId: 'agent-1',
    status,
    startedAt: 10,
    updatedAt: 20,
    metadata: {
      nested: {
        value: runId,
      },
    },
  };
}

describe('terminalWaiterRegistry', () => {
  it('每次调用都从 RunRegistryStore owner 读取最新终态', async () => {
    let record = {
      ...createRecord('run-1', 'cancelled'),
      currentNode: 'llm',
    };
    const loadRecord = vi.fn(async () => record);
    const registry = createTerminalWaiterRegistry({ loadRecord });

    await expect(registry.waitForTerminal(RunIdSchema.parse('run-1'))).resolves.toMatchObject({
      status: 'cancelled',
      currentNode: 'llm',
    });
    record = {
      ...record,
      updatedAt: 30,
      currentNode: 'cancelled',
      iterationsUsed: 7,
    };

    await expect(registry.waitForTerminal(RunIdSchema.parse('run-1'))).resolves.toMatchObject({
      status: 'cancelled',
      completedAt: 30,
      currentNode: 'cancelled',
      iterationsUsed: 7,
    });
    expect(loadRecord).toHaveBeenCalledTimes(2);
  });

  it('已终态记录直接返回由持久化记录投影的 outcome', async () => {
    const registry = createTerminalWaiterRegistry({
      loadRecord: async runId => ({
        ...createRecord(runId, 'failed'),
        updatedAt: 99,
        currentNode: 'llm',
        iterationsUsed: 3,
        errorIfAny: {
          errorCode: 'RUN_FAILED',
          message: 'boom',
          recoverable: false,
        },
      }),
    });

    await expect(registry.waitForTerminal(RunIdSchema.parse('run-1'))).resolves.toMatchObject({
      runId: 'run-1',
      status: 'failed',
      completedAt: 99,
      currentNode: 'llm',
      iterationsUsed: 3,
      error: {
        errorCode: 'RUN_FAILED',
      },
    });
  });

  it('run 不存在时抛 RunNotFoundError', async () => {
    const registry = createTerminalWaiterRegistry({
      loadRecord: async () => null,
    });

    await expect(registry.waitForTerminal(RunIdSchema.parse('missing-run'))).rejects.toBeInstanceOf(
      RunNotFoundError
    );
  });

  it('notify 唤醒 waiter 后仍从 store 读取终态，不消费通知携带的快照', async () => {
    let record = createRecord('run-1');
    const registry = createTerminalWaiterRegistry({
      loadRecord: async () => record,
    });

    const waiting = registry.waitForTerminal(RunIdSchema.parse('run-1'));
    await nextTask();
    record = {
      ...record,
      status: 'completed',
      updatedAt: 30,
      currentNode: 'answer',
      iterationsUsed: 4,
    };
    registry.notify(RunIdSchema.parse('run-1'));

    await expect(waiting).resolves.toMatchObject({
      runId: 'run-1',
      status: 'completed',
      completedAt: 30,
      currentNode: 'answer',
      iterationsUsed: 4,
    });
  });

  it('终态通知发生在首次 store read 返回前时不会漏掉', async () => {
    const runningRecord = createRecord('run-race');
    const terminalRecord = {
      ...runningRecord,
      status: 'completed' as const,
      updatedAt: 40,
      currentNode: 'answer',
    };
    let releaseFirstRead = (): void => undefined;
    const firstReadMayReturn = new Promise<void>(resolve => {
      releaseFirstRead = resolve;
    });
    let loadCount = 0;
    const registry = createTerminalWaiterRegistry({
      loadRecord: async () => {
        loadCount += 1;
        if (loadCount === 1) {
          await firstReadMayReturn;
          return runningRecord;
        }
        return terminalRecord;
      },
    });

    const waiting = registry.waitForTerminal(RunIdSchema.parse('run-race'));
    registry.notify(RunIdSchema.parse('run-race'));
    releaseFirstRead();

    await expect(waiting).resolves.toMatchObject({
      status: 'completed',
      currentNode: 'answer',
    });
    expect(loadCount).toBe(2);
  });

  it('timeout 到期时 reject 并清理 waiter', async () => {
    vi.useFakeTimers();
    try {
      const registry = createTerminalWaiterRegistry({
        loadRecord: async runId => createRecord(runId),
      });

      const waiting = registry.waitForTerminal(RunIdSchema.parse('run-1'), { timeoutMs: 10 });
      const assertion = expect(waiting).rejects.toThrow('waitForTerminal timed out for run run-1');
      await vi.advanceTimersByTimeAsync(10);

      await assertion;
      registry.notify(RunIdSchema.parse('run-1'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('AbortSignal abort 时 reject 并清理 waiter', async () => {
    const registry = createTerminalWaiterRegistry({
      loadRecord: async runId => createRecord(runId),
    });
    const controller = new AbortController();

    const waiting = registry.waitForTerminal(RunIdSchema.parse('run-1'), {
      signal: controller.signal,
    });
    const assertion = expect(waiting).rejects.toThrow('waitForTerminal aborted for run run-1');
    await nextTask();
    controller.abort();

    await assertion;
    registry.notify(RunIdSchema.parse('run-1'));
  });
});
