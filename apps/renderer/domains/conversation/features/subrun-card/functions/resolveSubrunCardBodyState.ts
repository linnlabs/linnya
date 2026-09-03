import type { LazySubrunTraceStatus } from '../../subrun-trace';

export type SubrunCardBodyState = 'error' | null;

export function resolveSubrunCardBodyState(params: {
  readonly childCount: number;
  readonly lazyStatus: LazySubrunTraceStatus;
  readonly hasProjectionError?: boolean;
}): SubrunCardBodyState {
  if (params.childCount > 0) return null;
  if (params.hasProjectionError) return 'error';
  if (params.lazyStatus === 'error') return 'error';
  return null;
}
