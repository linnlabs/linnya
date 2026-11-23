import { computed, onBeforeUnmount, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import type { RunScheduledTaskCard } from '../definitions/runScheduledTasks';
import { findRunScheduledTasksPort } from '../registry/runScheduledTasksPort';

const MAX_ENTRIES = 300;
/** 虚拟列表会卸载离开视口的行；按“会话 + 运行”缓存，重新挂载时直接拿到上次的卡片。 */
const cache = new Map<string, ShallowRef<readonly RunScheduledTaskCard[]>>();

function cacheEntry(key: string): ShallowRef<readonly RunScheduledTaskCard[]> {
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }
  const entry = shallowRef<readonly RunScheduledTaskCard[]>([]);
  cache.set(key, entry);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return entry;
}

export interface RunScheduledTasksState {
  readonly cards: ComputedRef<readonly RunScheduledTaskCard[]>;
  act(card: RunScheduledTaskCard, actionId: string): Promise<void>;
}

/** 一轮回复结束后读这轮建了或改了哪些定时任务；任务有变化时重读，卡片显示当前事实。 */
export function useRunScheduledTasks(input: {
  readonly conversationId: string | null;
  readonly rootRunIds: Ref<readonly string[]>;
  readonly enabled: Ref<boolean>;
}): RunScheduledTasksState {
  const port = findRunScheduledTasksPort();
  const entry = computed(() => {
    if (!port || !input.conversationId || input.rootRunIds.value.length === 0) return null;
    return cacheEntry(JSON.stringify([input.conversationId, ...input.rootRunIds.value]));
  });
  let generation = 0;

  function refresh(): void {
    const target = entry.value;
    if (!port || !input.conversationId || !target || !input.enabled.value) return;
    const current = ++generation;
    void port.list({ conversationId: input.conversationId, rootRunIds: input.rootRunIds.value })
      .then((cards) => {
        if (current === generation) target.value = cards;
      })
      .catch((error: unknown) => {
        console.warn('[RunScheduledTasks] 读取本轮建的定时任务失败', { error });
      });
  }

  watch([entry, input.enabled], refresh, { immediate: true });
  const stopWatching = port?.watch(refresh) ?? null;
  onBeforeUnmount(() => {
    generation += 1;
    stopWatching?.();
  });

  return {
    cards: computed(() => (input.enabled.value ? entry.value?.value ?? [] : [])),
    async act(card, actionId) {
      if (!port) return;
      try {
        await port.act(card, actionId);
      } catch (error: unknown) {
        console.warn('[RunScheduledTasks] 卡片操作失败', { taskId: card.taskId, actionId, error });
      }
    },
  };
}
