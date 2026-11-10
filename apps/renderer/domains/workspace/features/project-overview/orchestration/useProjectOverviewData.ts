import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import { PROJECT_OVERVIEW_MAX_DOCUMENT_IDS } from '@app/schemas';
import { subscribeToWorkspaceMutation } from '@/shared/ipc/workspaceMutationSubscription';
import { workspaceGateway } from '@/shared/ipc/workspaceGateway';
import type { ProjectOverviewRow, ProjectOverviewRefreshPlan } from '../definitions/projectOverview';
import { toProjectOverviewRow } from '../functions/projectOverviewRows';
import { refreshPlanFor } from '../functions/projectOverviewRefreshPlan';
import { readProjectOverview } from '../infrastructure/projectOverviewGateway';

/** 在别处连续编辑时合并刷新，避免每次保存都重读。 */
const REFRESH_THROTTLE_MS = 600;

export function useProjectOverviewData(projectId: Readonly<Ref<string | null>>) {
  const rows = shallowRef<ReadonlyMap<string, ProjectOverviewRow>>(new Map());
  const folderCount = ref<number | null>(null);
  const characterCount = ref<number | null>(null);
  const status = ref<'loading' | 'ready' | 'error'>('loading');
  const revision = ref(0);
  let generation = 0;
  let loadingGeneration: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let refreshAll = false;
  const refreshIds = new Set<string>();

  async function loadAll(target: string, current: number): Promise<void> {
    try {
      const overview = await readProjectOverview({ project_id: target });
      if (current !== generation) return;
      rows.value = new Map(overview.documents.map(document => [document.document_id, toProjectOverviewRow(document)]));
      folderCount.value = overview.folder_count;
      status.value = 'ready';
      revision.value += 1;
    } catch (error: unknown) {
      if (current !== generation) return;
      console.error('[ProjectOverview] 加载项目概览失败:', error);
      status.value = 'error';
    }
    await loadCharacterCount(target, current);
  }

  async function loadCharacterCount(target: string, current: number): Promise<void> {
    try {
      const result = await workspaceGateway['get-project-char-stats']({ projectId: target });
      if (current === generation) characterCount.value = result.success ? result.data.charCount : null;
    } catch (error: unknown) {
      if (current === generation) characterCount.value = null;
      console.error('[ProjectOverview] 加载项目字数失败:', error);
    }
  }

  async function loadDocuments(target: string, current: number, ids: readonly string[]): Promise<void> {
    try {
      const overview = await readProjectOverview({ project_id: target, document_ids: [...ids] });
      if (current !== generation) return;
      const next = new Map(rows.value);
      for (const id of ids) next.delete(id);
      for (const document of overview.documents) next.set(document.document_id, toProjectOverviewRow(document));
      rows.value = next;
      revision.value += 1;
    } catch (error: unknown) {
      console.error('[ProjectOverview] 刷新文档失败:', error);
    }
    await loadCharacterCount(target, current);
  }

  async function flush(): Promise<void> {
    timer = null;
    const target = projectId.value;
    // 同项目的快照与局部补读串行，避免旧快照覆盖更新；执行中的新事件留给下一轮。
    if (!target || loadingGeneration === generation) return;
    const current = generation;
    const ids = [...refreshIds];
    const all = refreshAll || status.value !== 'ready' || ids.length > PROJECT_OVERVIEW_MAX_DOCUMENT_IDS;
    refreshIds.clear();
    refreshAll = false;
    loadingGeneration = current;
    try {
      if (all) await loadAll(target, current);
      else if (ids.length > 0) await loadDocuments(target, current, ids);
    } finally {
      if (current === generation) {
        loadingGeneration = null;
        if (timer === null && (refreshAll || refreshIds.size > 0)) void flush();
      }
    }
  }

  function schedule(plan: ProjectOverviewRefreshPlan): void {
    if (plan.kind === 'none') return;
    if (plan.kind === 'all') refreshAll = true;
    else refreshIds.add(plan.id);
    timer ??= setTimeout(() => void flush(), REFRESH_THROTTLE_MS);
  }

  const unsubscribe = subscribeToWorkspaceMutation(event => {
    const target = projectId.value;
    if (target) schedule(refreshPlanFor(event, target));
  });

  watch(projectId, target => {
    generation += 1;
    if (timer) clearTimeout(timer);
    timer = null;
    refreshAll = false;
    refreshIds.clear();
    rows.value = new Map();
    folderCount.value = null;
    characterCount.value = null;
    status.value = 'loading';
    if (target) { refreshAll = true; void flush(); }
  }, { immediate: true });

  onScopeDispose(() => {
    generation += 1;
    if (timer) clearTimeout(timer);
    unsubscribe();
  });

  return { rows, folderCount, characterCount, status, revision };
}
