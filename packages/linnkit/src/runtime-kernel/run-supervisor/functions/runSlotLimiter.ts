import { RunConcurrencyLimitExceededError } from '../runErrors';

import type { RunId } from '../../../contracts';

export interface RunSlotLimiter {
  acquire(runId: RunId): void;
  release(runId: RunId): void;
  activeCount(): number;
}

export interface RunSlotLimiterOptions {
  maxActiveRuns?: number;
}

function normalizeMaxActiveRuns(maxActiveRuns: number | undefined): number | undefined {
  if (maxActiveRuns === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(maxActiveRuns) || maxActiveRuns < 1) {
    throw new RangeError('DefaultRunSupervisor.maxActiveRuns must be a positive integer');
  }
  return maxActiveRuns;
}

export function createRunSlotLimiter(options: RunSlotLimiterOptions = {}): RunSlotLimiter {
  const maxActiveRuns = normalizeMaxActiveRuns(options.maxActiveRuns);
  const activeRunSlots = new Set<string>();

  function acquire(runId: RunId): void {
    if (activeRunSlots.has(runId)) {
      return;
    }
    if (maxActiveRuns !== undefined && activeRunSlots.size >= maxActiveRuns) {
      throw new RunConcurrencyLimitExceededError(runId, maxActiveRuns, activeRunSlots.size);
    }
    activeRunSlots.add(runId);
  }

  function release(runId: RunId): void {
    activeRunSlots.delete(runId);
  }

  function activeCount(): number {
    return activeRunSlots.size;
  }

  return {
    acquire,
    release,
    activeCount,
  };
}
