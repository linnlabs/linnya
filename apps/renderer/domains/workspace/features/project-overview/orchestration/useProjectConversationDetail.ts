import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import type { ProjectConversationDetail } from '@app/schemas';
import { readProjectConversationDetail } from '../infrastructure/projectConversationsGateway';

/**
 * 选中对话的详情：第一个问题、最后的答复、改过的文档。列表重读（revision）时一起重读；
 * 重读期间保留旧内容，不闪空。
 */
export function useProjectConversationDetail(
  projectId: Readonly<Ref<string>>,
  conversationId: Readonly<Ref<string | null>>,
  revision: Readonly<Ref<number>>,
) {
  const detail = shallowRef<ProjectConversationDetail | null>(null);
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let generation = 0;

  async function load(target: string, id: string, current: number): Promise<void> {
    try {
      const result = await readProjectConversationDetail(target, id);
      if (current !== generation) return;
      detail.value = result;
      status.value = 'ready';
    } catch (error: unknown) {
      if (current !== generation) return;
      console.error('[ProjectConversations] 加载对话详情失败:', error);
      detail.value = null;
      status.value = 'error';
    }
  }

  watch([projectId, conversationId, revision], ([target, id], previous) => {
    generation += 1;
    if (!id) {
      detail.value = null;
      status.value = 'idle';
      return;
    }
    if (previous?.[1] !== id || previous[0] !== target) {
      detail.value = null;
      status.value = 'loading';
    }
    void load(target, id, generation);
  }, { immediate: true });

  onScopeDispose(() => { generation += 1; });

  return { detail, status };
}
