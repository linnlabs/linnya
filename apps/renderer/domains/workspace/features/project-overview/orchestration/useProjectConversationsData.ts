import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import type { ProjectConversationRow, ProjectConversationStorage } from '@app/schemas';
import { chunkConversationIds } from '../functions/projectConversationRows';
import {
  measureProjectConversationStorage,
  readProjectConversations,
} from '../infrastructure/projectConversationsGateway';

/** 对话历史变化（新回复、改名、置顶）常连续发生，合并后再重读。 */
const REFRESH_THROTTLE_MS = 600;
/** 一批测几个对话的占用；每批是一次短查询，不长时间占住 Backend。 */
const MEASURE_BATCH_SIZE = 8;

/**
 * 项目对话列表。列表本身随时读（页签上要显示数量）；占用只在对话页打开时补测，
 * 测量结果逐批合入，没测完的行显示为空。
 */
export function useProjectConversationsData(
  projectId: Readonly<Ref<string>>,
  historyKey: Readonly<Ref<string>>,
  measuring: Readonly<Ref<boolean>>,
) {
  const rows = shallowRef<readonly ProjectConversationRow[]>([]);
  const status = ref<'loading' | 'ready' | 'error'>('loading');
  /** 列表每重读一次加一，详情据此重读。 */
  const revision = ref(0);
  let generation = 0;
  let loading = false;
  let pending = false;
  /** 正在测量的列表代次；换项目后旧测量自行退出，不挡住新项目的测量。 */
  let measuringGeneration: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function load(): Promise<void> {
    if (loading) { pending = true; return; }
    loading = true;
    const current = generation;
    try {
      const result = await readProjectConversations(projectId.value);
      if (current !== generation) return;
      rows.value = result.conversations;
      status.value = 'ready';
      revision.value += 1;
    } catch (error: unknown) {
      if (current !== generation) return;
      console.error('[ProjectConversations] 加载对话列表失败:', error);
      if (status.value !== 'ready') status.value = 'error';
    } finally {
      loading = false;
      if (current === generation && pending) { pending = false; void load(); }
    }
    if (current === generation) void measureStale();
  }

  function mergeStorage(measured: ReadonlyMap<string, ProjectConversationStorage>): void {
    rows.value = rows.value.map(row => {
      const storage = measured.get(row.conversation_id);
      return storage ? { ...row, storage } : row;
    });
  }

  async function measureStale(): Promise<void> {
    const current = generation;
    if (!measuring.value || measuringGeneration === current) return;
    const stale = rows.value.filter(row => row.storage === null).map(row => row.conversation_id);
    if (stale.length === 0) return;
    measuringGeneration = current;
    try {
      for (const batch of chunkConversationIds(stale, MEASURE_BATCH_SIZE)) {
        if (current !== generation || !measuring.value) return;
        const result = await measureProjectConversationStorage(projectId.value, batch);
        if (current !== generation) return;
        mergeStorage(new Map(result.measurements.map(item => [item.conversation_id, item.storage])));
      }
    } catch (error: unknown) {
      console.error('[ProjectConversations] 测量对话占用失败:', error);
    } finally {
      if (measuringGeneration === current) measuringGeneration = null;
    }
  }

  /** 重测一个对话（清理过程文件后）。 */
  async function remeasure(conversationId: string): Promise<void> {
    const current = generation;
    try {
      const result = await measureProjectConversationStorage(projectId.value, [conversationId]);
      if (current === generation) {
        mergeStorage(new Map(result.measurements.map(item => [item.conversation_id, item.storage])));
      }
    } catch (error: unknown) {
      console.error('[ProjectConversations] 重测对话占用失败:', error);
    }
  }

  function scheduleRefresh(): void {
    timer ??= setTimeout(() => { timer = null; void load(); }, REFRESH_THROTTLE_MS);
  }

  watch(projectId, () => {
    generation += 1;
    if (timer) clearTimeout(timer);
    timer = null;
    loading = false;
    pending = false;
    rows.value = [];
    status.value = 'loading';
    void load();
  }, { immediate: true });

  watch(historyKey, scheduleRefresh);
  watch(measuring, value => { if (value) void measureStale(); });

  onScopeDispose(() => {
    generation += 1;
    if (timer) clearTimeout(timer);
  });

  return { rows, status, revision, refresh: scheduleRefresh, remeasure };
}
