import { ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import type { RunDocumentChangeList } from '../definitions/runDocumentChanges';

/**
 * 虚拟列表会卸载离开视口的行。按“会话 + 运行”缓存结果和展开状态，
 * 行重新挂载时同步拿到上次的结果，不先空后补，也不丢掉用户展开的清单。
 */
export interface RunDocumentChangesCacheEntry {
  readonly list: ShallowRef<RunDocumentChangeList | null>;
  readonly expanded: Ref<boolean>;
  readonly showAll: Ref<boolean>;
  generation: number;
}

const MAX_ENTRIES = 300;
const entries = new Map<string, RunDocumentChangesCacheEntry>();

export function runDocumentChangesCacheKey(conversationId: string, rootRunIds: readonly string[]): string {
  return JSON.stringify([conversationId, ...rootRunIds]);
}

export function getRunDocumentChangesCacheEntry(key: string): RunDocumentChangesCacheEntry {
  const existing = entries.get(key);
  if (existing) {
    // 最近用过的移到末尾，超出上限时先淘汰最久没用的。
    entries.delete(key);
    entries.set(key, existing);
    return existing;
  }
  const entry: RunDocumentChangesCacheEntry = {
    list: shallowRef(null),
    expanded: ref(false),
    showAll: ref(false),
    generation: 0,
  };
  entries.set(key, entry);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  return entry;
}

/** 仅供测试隔离。 */
export function clearRunDocumentChangesCache(): void {
  entries.clear();
}
