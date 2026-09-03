import { ref, shallowRef, watch } from 'vue';
import type { SubrunTraceBucketMap } from '../definitions/subrunTrace';
import { createSubrunTraceAccumulator } from '../functions/createSubrunTraceAccumulator';

function normalizeVersion(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function useSubrunTraceAccumulator(params: {
  readonly sourceKey: () => string;
  readonly liveTrace: () => unknown;
  readonly liveVersion: () => number | undefined;
  readonly historicalTrace: () => unknown;
  readonly historicalVersion: () => number | undefined;
}) {
  const accumulator = createSubrunTraceAccumulator();
  const trace = shallowRef<SubrunTraceBucketMap | null>(null);
  const version = ref(0);
  let admittedSourceKey: string | null = null;

  watch(
    () => [
      params.sourceKey(),
      normalizeVersion(params.liveVersion()),
      normalizeVersion(params.historicalVersion()),
      params.liveTrace(),
      params.historicalTrace(),
    ] as const,
    ([sourceKey]) => {
      let changed = false;
      if (sourceKey !== admittedSourceKey) {
        accumulator.reset();
        admittedSourceKey = sourceKey;
        changed = true;
      }

      changed = accumulator.admitHistorical(params.historicalTrace()) || changed;
      changed = accumulator.admitLive(params.liveTrace()) || changed;
      trace.value = accumulator.read();
      if (changed) version.value += 1;
    },
    { immediate: true, flush: 'sync' },
  );

  return { trace, version };
}
