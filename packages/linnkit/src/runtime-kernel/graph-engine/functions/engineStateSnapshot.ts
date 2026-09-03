import type { EngineLocalState } from '../types';
import { ContextUsageSnapshot } from '../../../contracts';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function asLocalRecord(local: EngineLocalState | Record<string, unknown> | undefined): Record<string, unknown> {
  return local && typeof local === 'object' ? local : {};
}

export function cloneEngineStateValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneEngineStateValue(item)) as T;
  }
  if (isPlainObject(value)) {
    const cloned: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      cloned[key] = cloneEngineStateValue(child);
    }
    return cloned as T;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  return value;
}

const NON_CHECKPOINT_LOCAL_KEYS = [
  'memory',
  'runtimeEventSink',
  'runtimeEventCommitPort',
  'runtimeFailureFactSink',
  'signal',
  'summarizationCallbacks',
  'toolContext',
] as const;

export function sanitizeCheckpointLocal(
  local: EngineLocalState | Record<string, unknown> | undefined,
): EngineLocalState {
  const cloned = cloneEngineStateValue(asLocalRecord(local));
  for (const key of NON_CHECKPOINT_LOCAL_KEYS) {
    delete cloned[key];
  }
  return cloned as EngineLocalState;
}

/** checkpoint 上一旦存在 contextUsage，就必须按公共合同严格 admission。 */
export function readCheckpointContextUsage(
  local: EngineLocalState | Record<string, unknown> | undefined,
) {
  const value = asLocalRecord(local).contextUsage;
  return value === undefined ? undefined : ContextUsageSnapshot.parse(value);
}
