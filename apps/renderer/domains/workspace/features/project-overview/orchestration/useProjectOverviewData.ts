import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import { useTimer } from '@linnya/renderer-ui';
import { PROJECT_OVERVIEW_MAX_DOCUMENT_IDS, type ProjectOverviewField } from '@app/schemas';
import { subscribeToWorkspaceMutation } from '@/shared/ipc/workspaceMutationSubscription';
import { workspaceGateway } from '@/shared/ipc/workspaceGateway';
import type { ProjectOverviewRow, ProjectOverviewRefreshPlan } from '../definitions/projectOverview';
import { toProjectOverviewRow } from '../functions/projectOverviewRows';
import { refreshPlanFor } from '../functions/projectOverviewRefreshPlan';
import { readProjectOverview } from '../infrastructure/projectOverviewGateway';

/** 在别处连续编辑时合并刷新，避免每次保存都重读。 */
const REFRESH_THROTTLE_MS = 600;
/** 读取失败后自动重试的次数与间隔（第 n 次等 n 个间隔）；用尽后留给下一次工作区事件。 */
const MAX_AUTO_RETRIES = 3;
const RETRY_DELAY_MS = 2_000;

/** 点名补读的发起方在等：读到这份文档之后才算完。 */
interface RefreshWaiter {
  readonly id: string;
  readonly resolve: () => void;
}

export function useProjectOverviewData(projectId: Readonly<Ref<string | null>>) {
  const rows = shallowRef<ReadonlyMap<string, ProjectOverviewRow>>(new Map());
  /** 挂在标签上的字段定义：字段条件的文字、看板分列用。 */
  const fields = shallowRef<readonly ProjectOverviewField[]>([]);
  const folderCount = ref<number | null>(null);
  const characterCount = ref<number | null>(null);
  const status = ref<'loading' | 'ready' | 'error'>('loading');
  const revision = ref(0);
  let generation = 0;
  let loadingGeneration: number | null = null;
  const refreshTimer = useTimer();
  let refreshAll = false;
  const refreshIds = new Set<string>();
  const waiters = new Set<RefreshWaiter>();
  /** 已交给正在执行的这一轮读取、等它结果的发起方。 */
  const inFlightWaiters = new Set<RefreshWaiter>();
  let failedRounds = 0;

  /** 取走在等这批文档（null 表示全部）的发起方；只有此刻之前登记的，读取才算晚于它们的写入。 */
  function takeWaiters(ids: ReadonlySet<string> | null): RefreshWaiter[] {
    const taken = [...waiters].filter(waiter => ids === null || ids.has(waiter.id));
    for (const waiter of taken) waiters.delete(waiter);
    return taken;
  }

  function releaseWaiters(): void {
    for (const waiter of [...waiters, ...inFlightWaiters]) waiter.resolve();
    waiters.clear();
    inFlightWaiters.clear();
  }

  /** 返回这一轮是否读到了数据；请求已作废（换项目）时返回 false，由调用方先判断代次。 */
  async function loadAll(target: string, current: number): Promise<boolean> {
    let loaded = false;
    try {
      const overview = await readProjectOverview({ project_id: target });
      if (current !== generation) return false;
      rows.value = new Map(overview.documents.map(document => [document.document_id, toProjectOverviewRow(document)]));
      fields.value = overview.fields;
      folderCount.value = overview.folder_count;
      status.value = 'ready';
      revision.value += 1;
      loaded = true;
    } catch (error: unknown) {
      if (current !== generation) return false;
      console.error('[ProjectOverview] 加载项目概览失败:', error);
      status.value = 'error';
    }
    await loadCharacterCount(target, current);
    return loaded;
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

  async function loadDocuments(target: string, current: number, ids: readonly string[]): Promise<boolean> {
    let loaded = false;
    try {
      const overview = await readProjectOverview({ project_id: target, document_ids: [...ids] });
      if (current !== generation) return false;
      const next = new Map(rows.value);
      for (const id of ids) next.delete(id);
      for (const document of overview.documents) next.set(document.document_id, toProjectOverviewRow(document));
      rows.value = next;
      fields.value = overview.fields;
      revision.value += 1;
      loaded = true;
    } catch (error: unknown) {
      console.error('[ProjectOverview] 刷新文档失败:', error);
    }
    await loadCharacterCount(target, current);
    return loaded;
  }

  async function flush(): Promise<void> {
    const target = projectId.value;
    // 同项目的快照与局部补读串行，避免旧快照覆盖更新；执行中的新事件留给下一轮。
    if (!target || loadingGeneration === generation) return;
    const current = generation;
    const ids = [...refreshIds];
    const all = refreshAll || status.value !== 'ready' || ids.length > PROJECT_OVERVIEW_MAX_DOCUMENT_IDS;
    refreshIds.clear();
    refreshAll = false;
    const covered = takeWaiters(all ? null : new Set(ids));
    for (const waiter of covered) inFlightWaiters.add(waiter);
    loadingGeneration = current;
    let loaded = true;
    try {
      if (all) loaded = await loadAll(target, current);
      else if (ids.length > 0) loaded = await loadDocuments(target, current, ids);
    } finally {
      if (current === generation) loadingGeneration = null;
      for (const waiter of covered) inFlightWaiters.delete(waiter);
    }
    if (current !== generation) {
      for (const waiter of covered) waiter.resolve();
      return;
    }
    if (loaded) {
      failedRounds = 0;
      for (const waiter of covered) waiter.resolve();
      if (!refreshTimer.pending && (refreshAll || refreshIds.size > 0)) void flush();
      return;
    }
    // 读取失败：这一轮的点名补读放回队列，稍后自动重试；重试用尽后仍留着，下一次工作区事件一并带上。
    if (all) refreshAll = true;
    else for (const id of ids) refreshIds.add(id);
    for (const waiter of covered) waiters.add(waiter);
    failedRounds += 1;
    if (failedRounds <= MAX_AUTO_RETRIES) {
      refreshTimer.startIfIdle(() => void flush(), RETRY_DELAY_MS * failedRounds);
    }
  }

  function schedule(plan: ProjectOverviewRefreshPlan): void {
    if (plan.kind === 'none') return;
    if (plan.kind === 'all') refreshAll = true;
    else refreshIds.add(plan.id);
    refreshTimer.startIfIdle(() => void flush(), REFRESH_THROTTLE_MS);
  }

  const unsubscribe = subscribeToWorkspaceMutation(event => {
    const target = projectId.value;
    if (target) schedule(refreshPlanFor(event, target));
  });

  watch(projectId, target => {
    generation += 1;
    refreshTimer.cancel();
    refreshAll = false;
    refreshIds.clear();
    failedRounds = 0;
    releaseWaiters();
    rows.value = new Map();
    fields.value = [];
    folderCount.value = null;
    characterCount.value = null;
    status.value = 'loading';
    if (target) { refreshAll = true; void flush(); }
  }, { immediate: true });

  onScopeDispose(() => {
    generation += 1;
    unsubscribe();
    releaseWaiters();
  });

  /**
   * 语义层的写入（看板拖动改值、Agent 打标签）不发工作区变更事件，由发起方点名补读。
   * 立即排进下一轮，不等节流。返回的 Promise 在读到这些文档的新值之后完成：读取失败时文档放回队列、
   * 自动重试几次，仍不成功就留到下一次读取成功；换项目或页面卸载时也会完成，调用方不必另做清理。
   */
  function refreshDocuments(ids: readonly string[]): Promise<void> {
    const done = Promise.all(ids.map(id => new Promise<void>(resolve => { waiters.add({ id, resolve }); })));
    for (const id of ids) refreshIds.add(id);
    refreshTimer.start(() => void flush(), 0);
    return done.then(() => undefined);
  }

  /** 标签或字段本身改了（改名、合并、删除）：所有文档的标签和字段都可能变，整份重读。 */
  function reloadAll(): void {
    refreshAll = true;
    refreshTimer.start(() => void flush(), 0);
  }

  return { rows, fields, folderCount, characterCount, status, revision, refreshDocuments, reloadAll };
}
