import { defineStore } from 'pinia';
import { markRaw } from 'vue';

import type {
  LoadedSubrunTrace,
  SubrunTraceHistoryCachePort,
} from '../definitions/subrunTrace';

interface CachedSubrunTrace {
  readonly invalidationRevision: number;
  readonly trace: LoadedSubrunTrace;
}

const MAX_READY_TRACE_SNAPSHOTS = 64;

/**
 * ConversationHost 切换父列表与 Subrun 详情时会结构性卸载其中一侧。缓存保存 exact source
 * 已接纳的完整历史快照，让重新挂载的父进度卡首帧高度稳定，也避免同一 trace 重复请求。
 */
export const useSubrunTraceHistoryCacheStore = defineStore(
  'conversationSubrunTraceHistoryCache',
  (): SubrunTraceHistoryCachePort => {
    const entries = new Map<string, CachedSubrunTrace>();

    return {
      read(sourceKey, invalidationRevision) {
        const entry = entries.get(sourceKey);
        if (entry?.invalidationRevision !== invalidationRevision) return null;
        entries.delete(sourceKey);
        entries.set(sourceKey, entry);
        return entry.trace;
      },
      write(sourceKey, invalidationRevision, trace) {
        // trace bucket 可能很大；它是 admission 后不可变快照，不应交给 Vue 深层代理。
        entries.delete(sourceKey);
        if (entries.size >= MAX_READY_TRACE_SNAPSHOTS) {
          const oldestSourceKey = entries.keys().next().value;
          if (typeof oldestSourceKey === 'string') entries.delete(oldestSourceKey);
        }
        entries.set(sourceKey, markRaw({
          invalidationRevision,
          trace: markRaw(trace),
        }));
      },
    };
  },
);
