import { RunConcurrencyKeyOccupiedError } from '../runErrors';

import type { RunId } from '../../../contracts';

export interface RunConcurrencyKeyRegistry {
  acquire(runId: RunId, concurrencyKey: string | undefined): void;
  release(runId: RunId): void;
}

/**
 * 为调用方定义的业务并发边界提供进程内原子占用。
 * key 的业务含义由 host 决定，supervisor 只保证活跃期内唯一。
 */
export function createRunConcurrencyKeyRegistry(): RunConcurrencyKeyRegistry {
  const runIdByKey = new Map<string, RunId>();
  const keyByRunId = new Map<RunId, string>();

  function acquire(runId: RunId, concurrencyKey: string | undefined): void {
    if (concurrencyKey === undefined) return;
    if (concurrencyKey.length === 0) {
      throw new RangeError('RunRegistrationSpec.concurrencyKey must not be empty');
    }
    const activeRunId = runIdByKey.get(concurrencyKey);
    if (activeRunId && activeRunId !== runId) {
      throw new RunConcurrencyKeyOccupiedError(concurrencyKey, activeRunId, runId);
    }
    runIdByKey.set(concurrencyKey, runId);
    keyByRunId.set(runId, concurrencyKey);
  }

  function release(runId: RunId): void {
    const concurrencyKey = keyByRunId.get(runId);
    if (!concurrencyKey) return;
    keyByRunId.delete(runId);
    if (runIdByKey.get(concurrencyKey) === runId) {
      runIdByKey.delete(concurrencyKey);
    }
  }

  return { acquire, release };
}
