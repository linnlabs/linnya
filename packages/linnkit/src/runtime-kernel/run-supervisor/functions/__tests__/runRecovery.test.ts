import { describe, expect, it, vi } from 'vitest';

import { MemoryRunRegistryStore } from '../../memoryRunRegistryStore';
import type { RunRecord } from '../../runRegistryStorePort';
import { recoverRunsOnBoot } from '../runRecovery';
import { RunIdSchema } from '../../../../contracts';

function createRecord(runId: string, status: RunRecord['status']): RunRecord {
  return {
    runId: RunIdSchema.parse(runId),
    conversationId: 'conv-1',
    agentSpecId: 'agent-1',
    status,
    startedAt: 10,
    updatedAt: 20,
    metadata: {
      existing: runId,
    },
  };
}

describe('runRecovery', () => {
  it('把非终态 run 标记为 RUN_ABANDONED 并通知 terminal outcome', async () => {
    const registryStore = new MemoryRunRegistryStore();
    await registryStore.save(createRecord('run-pending', 'pending'));
    await registryStore.save(createRecord('run-running', 'running'));
    await registryStore.save(createRecord('run-completed', 'completed'));
    const notifyTerminal = vi.fn();

    const outcomes = await recoverRunsOnBoot({
      registryStore,
      reason: 'process restarted',
      now: () => 99,
      notifyTerminal,
    });

    expect(outcomes.map(outcome => outcome.runId)).toEqual(['run-pending', 'run-running']);
    await expect(registryStore.load(RunIdSchema.parse('run-pending'))).resolves.toMatchObject({
      status: 'failed',
      updatedAt: 99,
      errorIfAny: {
        errorCode: 'RUN_ABANDONED',
        message: 'process restarted',
        recoverable: true,
      },
      metadata: {
        existing: 'run-pending',
        recovery: {
          reason: 'process restarted',
          recoveredAt: 99,
        },
      },
    });
    await expect(registryStore.load(RunIdSchema.parse('run-completed'))).resolves.toMatchObject({
      status: 'completed',
    });
    expect(notifyTerminal).toHaveBeenCalledTimes(2);
    expect(notifyTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-running',
        status: 'failed',
        completedAt: 99,
      })
    );
  });
});
