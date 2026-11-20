import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import { useTimer } from '@linnya/renderer-ui';
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
  const debounceTimer = useTimer();
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
      failed.value = false;
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

  let searched: { readonly projectId: string | null; readonly pattern: string } = { projectId: null, pattern: '' };
  watch([projectId, query, revision], ([target, value]) => {
    generation += 1;
    debounceTimer.cancel();
    const pattern = value.trim();
    // 只有项目或查询词变了才清掉旧命中；只是文档快照变化时保留，等新结果到达再换，
    // 否则每次保存都会让靠正文命中的行闪退一下。
    if (target !== searched.projectId || pattern !== searched.pattern) {
      matches.value = null;
      truncated.value = false;
      failed.value = false;
    }
    searched = { projectId: target, pattern };
    if (!target || !pattern) return;
    const current = generation;
    debounceTimer.start(() => void search(target, pattern, current), SEARCH_DEBOUNCE_MS);
  }, { immediate: true });

  // 防抖定时器由 useTimer 随作用域一起取消；这里只让在途请求作废。
  onScopeDispose(() => {
    generation += 1;
  });

  return { matches, truncated, failed };
}
