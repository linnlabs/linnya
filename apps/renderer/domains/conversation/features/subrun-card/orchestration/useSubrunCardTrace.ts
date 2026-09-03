import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';

import type { BaseMessage } from '../../../types';
import {
  findSubrunTraceBucket,
  SUBRUN_TRACE_SUBRUN_CARD_KINDS,
  readSubrunTraceSourceKey,
  useLazySubrunTrace,
  useSubrunTraceHistoryCacheStore,
  useSubrunTraceInvalidationStore,
  useSubrunTraceAccumulator,
  type HistoricalSubrunTraceLazySource,
} from '../../subrun-trace';
import { resolveSubrunCardTraceSource } from '../functions/resolveSubrunCardTraceSource';
import { createSubrunMessageAdmissionScheduler } from './createSubrunMessageAdmissionScheduler';

export function useSubrunCardTrace(params: {
  readonly subrunTrace: () => unknown;
  readonly subrunTraceVersion: () => number | undefined;
  readonly subrunId: () => string | undefined;
  readonly lazySource: () => HistoricalSubrunTraceLazySource | undefined;
}) {
  const messages = shallowRef<readonly BaseMessage[]>([]);
  const projectionError = shallowRef<Error | null>(null);
  const lazySource = computed<HistoricalSubrunTraceLazySource | undefined>(() => {
    return resolveSubrunCardTraceSource({
      source: params.lazySource(),
      subrunId: params.subrunId(),
      kinds: SUBRUN_TRACE_SUBRUN_CARD_KINDS,
    });
  });
  const traceInvalidationStore = useSubrunTraceInvalidationStore();
  const traceHistoryCache = useSubrunTraceHistoryCacheStore();
  const lazyTrace = useLazySubrunTrace(
    () => lazySource.value,
    undefined,
    () => {
      const source = lazySource.value;
      return source
        ? traceInvalidationStore.revisionFor(source.conversationId)
        : 0;
    },
    traceHistoryCache,
  );
  const accumulatedTrace = useSubrunTraceAccumulator({
    sourceKey: () => {
      const source = lazySource.value;
      return source
        ? `${source.conversationId}|${source.parentToolCallId}|${source.subrunId ?? ''}`
        : `${readSubrunTraceSourceKey(params.subrunTrace()) ?? 'unscoped-card'}|${params.subrunId() ?? ''}`;
    },
    liveTrace: params.subrunTrace,
    liveVersion: params.subrunTraceVersion,
    historicalTrace: () => lazyTrace.buckets.value,
    historicalVersion: () => lazyTrace.version.value,
  });

  const bucket = computed(() => findSubrunTraceBucket(
    accumulatedTrace.trace.value,
    lazySource.value?.subrunId ?? params.subrunId() ?? '',
  ));
  const scheduler = createSubrunMessageAdmissionScheduler({
    onCommit: snapshot => {
      projectionError.value = null;
      messages.value = snapshot.messages;
    },
    onError: error => {
      projectionError.value = error;
      const source = lazySource.value;
      console.error('[SubrunCard] 子过程消息未通过 presentation admission', {
        conversationId: source?.conversationId,
        parentToolCallId: source?.parentToolCallId,
        subrunId: source?.subrunId ?? params.subrunId(),
        error,
      });
    },
  });
  watch(
    [bucket, accumulatedTrace.version],
    () => scheduler.request(bucket.value),
    { immediate: true, flush: 'sync' },
  );
  onBeforeUnmount(() => scheduler.dispose());

  async function loadWhenExpanded(): Promise<void> {
    const source = lazySource.value;
    if (!source) return;
    if (
      lazyTrace.status.value === 'loading'
      || lazyTrace.status.value === 'ready'
    ) return;

    try {
      await lazyTrace.load();
    } catch (error) {
      console.warn('[SubrunCard] 历史 subrun 过程加载失败', {
        conversationId: source.conversationId,
        parentToolCallId: source.parentToolCallId,
        subrunId: source.subrunId,
        error,
      });
    }
  }

  return {
    bucket,
    lazyStatus: lazyTrace.status,
    loadWhenExpanded,
    messages,
    projectionError,
  };
}
