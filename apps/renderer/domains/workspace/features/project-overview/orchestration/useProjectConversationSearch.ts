import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import { searchProjectConversations } from '../infrastructure/projectConversationsGateway';

const SEARCH_DEBOUNCE_MS = 250;

/**
 * 搜标题和可读对话内容（用户的话与 AI 的答复，不含执行过程）。
 * 返回命中的对话与命中处的一小段原文；为 null 表示没有在搜。输入过程中保留上一次结果，避免列表闪回全部。
 */
export function useProjectConversationSearch(
  projectId: Readonly<Ref<string>>,
  query: Readonly<Ref<string>>,
  revision: Readonly<Ref<number>>,
) {
  const matches = shallowRef<ReadonlyMap<string, string | null> | null>(null);
  const truncated = ref(false);
  const failed = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  async function search(target: string, pattern: string, current: number): Promise<void> {
    try {
      const result = await searchProjectConversations(target, pattern);
      if (current !== generation) return;
      matches.value = new Map(result.matches.map(match => [match.conversation_id, match.excerpt]));
      truncated.value = result.truncated;
      failed.value = false;
    } catch (error: unknown) {
      if (current !== generation) return;
      console.error('[ProjectConversations] 搜索对话失败:', error);
      matches.value = new Map();
      truncated.value = false;
      failed.value = true;
    }
  }

  watch([projectId, query, revision], ([target, value], previous) => {
    generation += 1;
    if (timer) clearTimeout(timer);
    timer = null;
    const pattern = value.trim();
    if (!pattern || previous?.[0] !== target) {
      matches.value = null;
      truncated.value = false;
      failed.value = false;
    }
    if (!pattern) return;
    const current = generation;
    timer = setTimeout(() => void search(target, pattern, current), SEARCH_DEBOUNCE_MS);
  }, { immediate: true });

  onScopeDispose(() => {
    generation += 1;
    if (timer) clearTimeout(timer);
  });

  return { matches, truncated, failed };
}
