import { describe, expect, it } from 'vitest';

import type { RunRecord } from '../../runRegistryStorePort';
import {
  cloneRunMetadata,
  runRecordToMeta,
  runRecordToSnapshot,
  runRecordToTerminalOutcome,
} from '../runRecordProjection';
import { RunIdSchema } from '../../../../contracts';

function createRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: RunIdSchema.parse('run-1'),
    parentRunId: RunIdSchema.parse('parent-1'),
    conversationId: 'conv-1',
    agentSpecId: 'agent-1',
    status: 'completed',
    currentNode: 'answer',
    startedAt: 10,
    updatedAt: 20,
    pausedAt: 15,
    pauseReason: 'waiting',
    iterationsUsed: 3,
    errorIfAny: {
      errorCode: 'RUN_FAILED',
      message: 'boom',
      recoverable: false,
    },
    metadata: {
      nested: {
        value: 'original',
      },
    },
    ...overrides,
  };
}

describe('runRecordProjection', () => {
  it('runRecordToMeta 只投影公开 RunMeta 字段，不携带 metadata', () => {
    expect(runRecordToMeta(createRecord())).toEqual({
      runId: 'run-1',
      parentRunId: 'parent-1',
      agentSpecId: 'agent-1',
      conversationId: 'conv-1',
      status: 'completed',
      currentNode: 'answer',
      startedAt: 10,
      updatedAt: 20,
      pausedAt: 15,
      pauseReason: 'waiting',
      iterationsUsed: 3,
      errorIfAny: {
        errorCode: 'RUN_FAILED',
        message: 'boom',
        recoverable: false,
      },
    });
  });

  it('runRecordToSnapshot 携带 metadata 克隆，避免外部改写 store 对象', () => {
    const record = createRecord();
    const snapshot = runRecordToSnapshot(record);
    snapshot.metadata = { changed: true };

    expect(record.metadata).toEqual({
      nested: {
        value: 'original',
      },
    });
  });

  it('runRecordToTerminalOutcome 映射终态字段并克隆 metadata', () => {
    const record = createRecord();
    const outcome = runRecordToTerminalOutcome(record, 99);
    outcome.metadata = { changed: true };

    expect(outcome).toMatchObject({
      runId: 'run-1',
      status: 'completed',
      completedAt: 99,
      currentNode: 'answer',
      iterationsUsed: 3,
      error: {
        errorCode: 'RUN_FAILED',
      },
    });
    expect(record.metadata).toEqual({
      nested: {
        value: 'original',
      },
    });
  });

  it('非终态记录转 terminal outcome 时按 failed 兜底', () => {
    expect(runRecordToTerminalOutcome(createRecord({ status: 'running' }), 99).status).toBe(
      'failed'
    );
  });

  it('cloneRunMetadata 在缺失 metadata 时保持 undefined', () => {
    expect(cloneRunMetadata(undefined)).toBeUndefined();
  });
});
