import { describe, expect, it } from 'vitest';

import { MemoryRunRegistryStore } from '../memoryRunRegistryStore';
import type { RunRecord } from '../runRegistryStorePort';
import { RunIdSchema } from '../../../contracts';

function createRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: RunIdSchema.parse('run-1'),
    conversationId: 'conv-1',
    status: 'running',
    startedAt: 10,
    updatedAt: 10,
    ...overrides,
  };
}

describe('RunRegistryStore contract', () => {
  it('round-trips saved records by runId', async () => {
    const store = new MemoryRunRegistryStore();
    const record = createRunRecord({
      parentRunId: RunIdSchema.parse('parent-1'),
      iterationsUsed: 3,
      metadata: { feature: 'deep-research' },
    });

    await store.save(record);

    await expect(store.load(RunIdSchema.parse('run-1'))).resolves.toEqual(record);
  });

  it('lists runs by status and parentRunId filters', async () => {
    const store = new MemoryRunRegistryStore();

    await store.save(
      createRunRecord({
        runId: RunIdSchema.parse('run-1'),
        parentRunId: RunIdSchema.parse('parent-1'),
        status: 'running',
      })
    );
    await store.save(
      createRunRecord({
        runId: RunIdSchema.parse('run-2'),
        parentRunId: RunIdSchema.parse('parent-1'),
        status: 'completed',
      })
    );
    await store.save(
      createRunRecord({
        runId: RunIdSchema.parse('run-3'),
        parentRunId: RunIdSchema.parse('parent-2'),
        status: 'running',
      })
    );

    const result = await store.list({
      status: 'running',
      parentRunId: RunIdSchema.parse('parent-1'),
    });

    expect(result.nextCursor).toBeUndefined();
    expect(result.runs).toEqual([
      createRunRecord({
        runId: RunIdSchema.parse('run-1'),
        parentRunId: RunIdSchema.parse('parent-1'),
        status: 'running',
      }),
    ]);
  });

  it('round-trips paused records for N-3.B pause/resume wiring', async () => {
    const store = new MemoryRunRegistryStore();
    const record = createRunRecord({
      status: 'paused',
      pausedAt: 20,
      pauseReason: '用户稍后继续',
    });

    await store.save(record);

    await expect(store.load(RunIdSchema.parse('run-1'))).resolves.toEqual(record);
  });

  it('lists runs by agentSpecId filter', async () => {
    const store = new MemoryRunRegistryStore();

    await store.save(
      createRunRecord({
        runId: RunIdSchema.parse('run-1'),
        agentSpecId: 'deep_research_leader',
        startedAt: 30,
        updatedAt: 30,
      })
    );
    await store.save(
      createRunRecord({
        runId: RunIdSchema.parse('run-2'),
        agentSpecId: 'translation',
        startedAt: 20,
        updatedAt: 20,
      })
    );
    await store.save(
      createRunRecord({
        runId: RunIdSchema.parse('run-3'),
        agentSpecId: 'deep_research_leader',
        startedAt: 10,
        updatedAt: 10,
      })
    );

    const result = await store.list({ agentSpecId: 'deep_research_leader' });

    expect(result.nextCursor).toBeUndefined();
    expect(result.runs).toEqual([
      createRunRecord({
        runId: RunIdSchema.parse('run-1'),
        agentSpecId: 'deep_research_leader',
        startedAt: 30,
        updatedAt: 30,
      }),
      createRunRecord({
        runId: RunIdSchema.parse('run-3'),
        agentSpecId: 'deep_research_leader',
        startedAt: 10,
        updatedAt: 10,
      }),
    ]);
  });

  it('deletes records by runId', async () => {
    const store = new MemoryRunRegistryStore();

    await store.save(createRunRecord());
    await store.delete(RunIdSchema.parse('run-1'));

    await expect(store.load(RunIdSchema.parse('run-1'))).resolves.toBeNull();
  });
});
