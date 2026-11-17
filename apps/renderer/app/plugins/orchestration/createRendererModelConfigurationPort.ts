import { watch } from 'vue';
import { PromptKeys } from '@app/schemas';
import type { RendererModelConfigurationPort } from '@linnya/plugin-host-contract/renderer/modelConfiguration';
import {
  readEffectiveModelPurposeBinding,
  readEffectiveAuxiliaryModelPurposeBinding,
  useModelCatalogReadModel,
  registerEmbeddingModelChangeImpactPort,
} from '@/domains/model-configuration';
import { useUIStore } from '@/shared/stores/ui';

/** 插件只取得有效选择与名称；Provider、连接和凭据不会进入该投影。 */
export function createRendererModelConfigurationPort(): RendererModelConfigurationPort {
  const modelName = (modelId: string): string | null => {
    const model = useModelCatalogReadModel().models.value.find(item => item.id === modelId);
    return model ? model.display_name || model.name || model.model_name || model.id : null;
  };
  return {
    readPurposeModelId: readEffectiveModelPurposeBinding,
    readAuxiliaryModelId: () => readEffectiveAuxiliaryModelPurposeBinding(PromptKeys.KNOWLEDGE_GRAPH_EXTRACTION),
    readModelDisplayName: modelName,
    subscribeChanges(listener) {
      return watch(() => [
        readEffectiveModelPurposeBinding('embedding'),
        readEffectiveModelPurposeBinding('rerank'),
        readEffectiveModelPurposeBinding('pdf_ocr'),
        readEffectiveModelPurposeBinding('image_vision'),
        readEffectiveAuxiliaryModelPurposeBinding(PromptKeys.KNOWLEDGE_GRAPH_EXTRACTION),
        useModelCatalogReadModel().models.value.map(model => [model.id, model.display_name, model.name, model.model_name]),
      ], listener, { deep: true });
    },
    openModelConfiguration: () => useUIStore().openSettingsModal('model-config'),
    registerEmbeddingImpact: registerEmbeddingModelChangeImpactPort,
  };
}
