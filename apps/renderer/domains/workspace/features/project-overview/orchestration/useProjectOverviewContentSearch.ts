import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import { workspaceGateway } from '@/shared/ipc/workspaceGateway';

const SEARCH_DEBOUNCE_MS = 250;
/** 正文搜索按“行”计数；一份文档可能命中多行。 */
export const PROJECT_OVERVIEW_CONTENT_SEARCH_MAX_MATCHES = 500;

/**
 * 正文搜索走 VFS 的行级索引（与 Agent 的 grep 同一份），按字面量匹配。
 * 返回命中的文档身份；为 null 表示没有在搜。
 */
export function useProjectOverviewContentSearch(
  projectId: Readonly<Ref<string | null>>,
  query: Readonly<Ref<string>>,
  revision: Readonly<Ref<number>>,
) {
  const matches = shallowRef<ReadonlySet<string> | null>(null);
  const truncated = ref(false);
  const failed = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  async function search(target: string, pattern: string, current: number): Promise<void> {
    try {
      const result = await workspaceGateway['search-vfs-nodes']({
        projectId: target,
        pattern,
        maxResults: PROJECT_OVERVIEW_CONTENT_SEARCH_MAX_MATCHES,
      });
      if (current !== generation) return;
      if (!result.success || !result.data.ok) {
        failed.value = true;
        matches.value = new Set();
        truncated.value = false;
        return;
      }
      matches.value = new Set(result.data.matches.map(match => match.node.id));
      truncated.value = result.data.truncated;
    } catch (error: unknown) {
      if (current !== generation) return;
      failed.value = true;
      console.error('[ProjectOverview] 正文搜索失败:', error);
      matches.value = new Set();
      truncated.value = false;
    }
  }

  watch([projectId, query, revision], ([target, value]) => {
    generation += 1;
    if (timer) clearTimeout(timer);
    timer = null;
    matches.value = null;
    truncated.value = false;
    failed.value = false;
    const pattern = value.trim();
    if (!target || !pattern) {
      matches.value = null;
      truncated.value = false;
      return;
    }
    const current = generation;
    timer = setTimeout(() => void search(target, pattern, current), SEARCH_DEBOUNCE_MS);
  }, { immediate: true });

  onScopeDispose(() => {
    generation += 1;
    if (timer) clearTimeout(timer);
  });

  return { matches, truncated, failed };
}
