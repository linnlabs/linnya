import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import { useTimer } from '@linnya/renderer-ui';
import type { ProjectConversationQueryOptions, ProjectConversationsQuery } from '@app/schemas';
import { queryProjectConversations } from '../infrastructure/projectConversationsGateway';

/** UI 只连接查询条件，筛选与非本地化排序由 Host 与 Shell 共用。换项目立即清空，旧响应不能覆盖新结果。 */
export function useProjectConversationQuery(
  projectId: Readonly<Ref<string>>,
  options: Readonly<Ref<ProjectConversationQueryOptions>>,
  refreshKey: Readonly<Ref<unknown>>,
) {
  const result = shallowRef<ProjectConversationsQuery | null>(null);
  const failed = ref(false);
  const loading = ref(true);
  let generation = 0;
  const timer = useTimer();

  async function load(target: string, query: ProjectConversationQueryOptions, current: number): Promise<void> {
    try {
      const value = await queryProjectConversations(target, query);
      if (generation !== current) return;
      result.value = value;
      failed.value = false;
    } catch (error: unknown) {
      if (generation !== current) return;
      console.error('[ProjectConversations] 查询失败:', error);
      failed.value = true;
      result.value = null;
    } finally {
      if (generation === current) loading.value = false;
    }
  }

  watch([projectId, options, refreshKey], ([target, query], previous) => {
    const current = ++generation;
    timer.cancel();
    if (previous?.[0] !== target) result.value = null;
    loading.value = true;
    const delay = previous?.[1] && previous[1].query !== query.query ? 250 : 0;
    if (delay) timer.start(() => { void load(target, query, current); }, delay);
    else void load(target, query, current);
  }, { immediate: true });
  onScopeDispose(() => { generation += 1; });
  return { result, failed, loading };
}
