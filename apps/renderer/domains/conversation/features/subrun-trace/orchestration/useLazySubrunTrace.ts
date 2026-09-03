import { computed, ref, watch } from 'vue';
import type {
  HistoricalSubrunTraceLazySource,
  LoadSubrunTraceResult,
  ReadSubrunTraceOptions,
  SubrunTraceBucketMap,
  SubrunTraceHistoryCachePort,
} from '../definitions/subrunTrace';
import { loadCompleteSubrunTrace } from './loadSubrunTrace';

export type LazySubrunTraceStatus = 'idle' | 'loading' | 'ready' | 'preparing' | 'error';

type LoadSubrunTraceFn = (
  conversationId: string,
  parentToolCallId: string,
  options: ReadSubrunTraceOptions,
) => Promise<LoadSubrunTraceResult>;

export function useLazySubrunTrace(
  source: () => HistoricalSubrunTraceLazySource | undefined,
  loadTrace: LoadSubrunTraceFn = loadCompleteSubrunTrace,
  refreshVersion: () => number = () => 0,
  cache?: SubrunTraceHistoryCachePort,
) {
  const buckets = ref<SubrunTraceBucketMap | null>(null);
  const version = ref(0);
  const status = ref<LazySubrunTraceStatus>('idle');
  let requestGeneration = 0;
  let wasRequested = false;

  const sourceKey = computed(() => {
    const current = source();
    if (!current) return '';
    return [
      current.conversationId,
      current.parentToolCallId,
      current.subrunId ?? '',
      current.kinds.join(','),
    ].join('|');
  });

  function hydrateFromCache(key: string): boolean {
    if (!key || !cache) return false;
    const cached = cache.read(key, refreshVersion());
    if (!cached) return false;
    buckets.value = cached.buckets;
    version.value += Math.max(cached.eventCount, 1);
    status.value = 'ready';
    return true;
  }

  hydrateFromCache(sourceKey.value);

  watch(
    () => [sourceKey.value, refreshVersion()] as const,
    ([nextSourceKey, nextRefreshVersion], [previousSourceKey, previousRefreshVersion]) => {
      if (nextSourceKey !== previousSourceKey) {
        requestGeneration += 1;
        buckets.value = null;
        version.value = 0;
        status.value = 'idle';
      }

      const hydrated = hydrateFromCache(nextSourceKey);

      if (
        wasRequested
        && nextSourceKey
        && !hydrated
        && (
          nextSourceKey !== previousSourceKey
          || nextRefreshVersion !== previousRefreshVersion
        )
      ) {
        reloadRequestedTrace();
      }
    },
    { flush: 'sync' },
  );

  async function load(): Promise<void> {
    // 用户可能在 durable source 尚未出现时展开；保留请求意图，source 建立后立即读取。
    wasRequested = true;
    await loadCurrentSource(false);
  }

  function reloadRequestedTrace(): void {
    // durable revision 刷新时保留旧快照，避免异步读取期间让 UI 短暂退回 stale live 状态。
    void loadCurrentSource(true).catch((error: unknown) => {
      const current = source();
      console.warn('[SubrunTrace] durable trace 自动重读失败', {
        conversationId: current?.conversationId,
        parentToolCallId: current?.parentToolCallId,
        error,
      });
    });
  }

  async function loadCurrentSource(force: boolean): Promise<void> {
    const current = source();
    if (!current) return;
    // single child 的 ID 可能在用户展开后才随首条 trace summary 到达。保留读取意图，
    // 等 source key 获得正式 subrunId 后由 watcher 自动加载；绝不退回 parent-wide 查询。
    if (!current.subrunId) return;
    if (!force && (status.value === 'loading' || status.value === 'ready')) return;

    const generation = ++requestGeneration;
    const requestedSourceKey = sourceKey.value;
    status.value = 'loading';
    try {
      const result = await loadTrace(current.conversationId, current.parentToolCallId, {
        subrunId: current.subrunId,
        kinds: current.kinds,
        limit: 2000,
      });
      if (generation !== requestGeneration || requestedSourceKey !== sourceKey.value) return;
      if (result.status === 'preparing') {
        status.value = 'preparing';
        return;
      }
      cache?.write(requestedSourceKey, refreshVersion(), result);
      buckets.value = result.buckets;
      version.value += Math.max(result.eventCount, 1);
      status.value = 'ready';
    } catch (error) {
      if (generation !== requestGeneration || requestedSourceKey !== sourceKey.value) return;
      status.value = 'error';
      throw error;
    }
  }

  return {
    buckets,
    version,
    status,
    load,
  };
}
