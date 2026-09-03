import { modelCatalog } from 'src/domains/model-catalog';
import type { llm } from '@linnlabs/linnkit/runtime-kernel';
import type { ModelConfig } from 'src/domains/model-catalog';

export function toRuntimeModelCatalogEntry(config: ModelConfig): llm.ModelCatalogEntry {
  return {
    ...config,
    adapter_input_support: config.inference_route?.input_support ?? {
      user_image: false,
      tool_result_image: false,
    },
  };
}

export const defaultModelCatalog: llm.ModelCatalogLike = {
  getModelById(id) {
    const config = modelCatalog.getModel(id);
    return config ? toRuntimeModelCatalogEntry(config) : undefined;
  },
  getModelsByCapability(capability) {
    return modelCatalog.getModelsByCapability(capability).map(toRuntimeModelCatalogEntry);
  },
  getModelsByUIVisibility(visibility) {
    return modelCatalog.getModelsByUIVisibility(visibility).map(toRuntimeModelCatalogEntry);
  },
};
