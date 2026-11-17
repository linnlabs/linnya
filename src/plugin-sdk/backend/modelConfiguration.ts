import type { PluginModelConfigurationPort } from '@linnya/plugin-host-contract/backend/modelConfiguration';
import { getDefaultModelIdByCapability, modelCatalog } from 'src/domains/model-catalog';

export type * from '@linnya/plugin-host-contract/backend/modelConfiguration';

export function getPluginModelConfigurationPort(): PluginModelConfigurationPort {
  return {
    readDefaultModelIdByCapability: getDefaultModelIdByCapability,
    readAuxiliaryModelBinding(promptKey) {
      const id = modelCatalog.getFunctionalDefaultModelId(promptKey);
      const model = id ? modelCatalog.getModel(id) : undefined;
      return model?.id;
    },
    getModelDisplayName(modelId) {
      return modelCatalog.getModel(modelId)?.display_name;
    },
  };
}
