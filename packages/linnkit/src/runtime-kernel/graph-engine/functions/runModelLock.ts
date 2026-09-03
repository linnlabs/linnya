import type { ExecutorLocalPatch } from '../types';

export interface RunModelLockDecision {
  executorLocalPatch?: ExecutorLocalPatch;
  shouldLog: boolean;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function decideRunModelLockPatch(params: {
  stageId: string;
  appliedFallbackModelId: unknown;
  currentRunLockedModelId: unknown;
}): RunModelLockDecision {
  if (params.stageId !== 'execute_llm') {
    return { shouldLog: false };
  }

  const normalized = readNonEmptyString(params.appliedFallbackModelId);
  if (!normalized) {
    return { shouldLog: false };
  }

  if (readNonEmptyString(params.currentRunLockedModelId) === normalized) {
    return { shouldLog: false };
  }

  return {
    executorLocalPatch: { runLockedModelId: normalized },
    shouldLog: true,
  };
}
