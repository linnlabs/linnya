import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
import { useTimer } from '@linnya/renderer-ui';
import type { KnowledgeIndexJobStatus } from '../../shared';
import { knowledgeBaseService } from '../services/knowledgeBaseService';
import { readPurposeModelId, readModelDisplayName, subscribeModelConfigurationChanges } from '@plugin/renderer/modelConfiguration';

/** 请求绑定当前页面的库身份，切库/停用后旧轮询不得写入新界面。 */
export function useKnowledgeIndexRebuild(kbId: Ref<string | undefined>, refresh: () => Promise<unknown>) {
  const modelRevision = ref(0);
  const unsubscribeModelChanges = subscribeModelConfigurationChanges(() => { modelRevision.value++; });
  onScopeDispose(unsubscribeModelChanges);
  const modelId = computed(() => { void modelRevision.value; return readPurposeModelId('embedding'); });
  const modelName = computed(() => { void modelRevision.value; return modelId.value ? readModelDisplayName(modelId.value) ?? modelId.value : ''; });
  const status = ref<KnowledgeIndexJobStatus | null>(null);
  const error = ref('');
  let generation = 0;
  const timer = useTimer();
  let disposed = false;
  const stop = () => { generation++; timer.cancel(); };
  async function poll(id: string, version: number): Promise<void> {
    try {
      const next = await knowledgeBaseService.getIndexRebuildStatus(id);
      if (disposed || generation !== version || kbId.value !== id) return;
      const wasRunning = status.value?.status === 'running';
      status.value = next;
      if (next?.status === 'running') timer.start(() => { void poll(id, version); }, 500);
      else if (wasRunning && next?.status === 'completed') await refresh();
    } catch (cause) {
      if (!disposed && generation === version) error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  watch(kbId, id => { stop(); status.value = null; error.value = ''; if (id) void poll(id, generation); }, { immediate: true });
  onScopeDispose(() => { disposed = true; stop(); });
  async function start(request: { kbId: string; modelId: string }): Promise<void> {
    const version = generation;
    try {
      const task = await knowledgeBaseService.rebuildIndex(request.kbId, request.modelId);
      if (disposed || generation !== version || kbId.value !== request.kbId) return;
      status.value = task; error.value = '';
      await poll(request.kbId, version);
    } catch (cause) {
      if (!disposed && generation === version) error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  async function cancel(): Promise<void> {
    const task = status.value;
    const version = generation;
    try {
      if (task?.status === 'running') await knowledgeBaseService.cancelTask(task.jobId);
    } catch (cause) {
      if (!disposed && generation === version) error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  return { modelId, modelName, status, error, start, cancel, busy: computed(() => status.value?.status === 'running') };
}
