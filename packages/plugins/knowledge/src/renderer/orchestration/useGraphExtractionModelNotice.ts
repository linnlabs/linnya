import { computed, onScopeDispose, ref, type Ref } from 'vue';
import {
  openModelConfiguration,
  readAuxiliaryModelId,
  subscribeModelConfigurationChanges,
} from '@plugin/renderer/modelConfiguration';
import { needsGraphExtractionModel } from '../functions/graphExtractionModelNotice';

/** 模型选择不是响应式数据，跟着 Host 的变更通知重读，用户在设置里选好模型后提示立即消失。 */
export function useGraphExtractionModelNotice(graphEnabled: Ref<boolean>) {
  const modelRevision = ref(0);
  const unsubscribeModelChanges = subscribeModelConfigurationChanges(() => { modelRevision.value++; });
  onScopeDispose(unsubscribeModelChanges);
  const graphExtractionModelId = computed(() => {
    void modelRevision.value;
    return readAuxiliaryModelId('graph_extraction');
  });
  const graphExtractionModelMissing = computed(() => graphExtractionModelId.value === null);
  const showGraphExtractionModelNotice = computed(() =>
    needsGraphExtractionModel(graphEnabled.value, graphExtractionModelId.value));
  return { graphExtractionModelMissing, showGraphExtractionModelNotice, openModelConfiguration };
}
