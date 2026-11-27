import type { PluginModelConfigurationPort } from '@linnya/plugin-host-contract/backend/modelConfiguration';
import { getDefaultModelIdByCapability, modelCatalog } from 'src/domains/model-catalog';

export type * from '@linnya/plugin-host-contract/backend/modelConfiguration';

export function getPluginModelConfigurationPort(): PluginModelConfigurationPort {
  return {
    readDefaultModelIdByCapability: getDefaultModelIdByCapability,
    getModelDisplayName(modelId) {
      return modelCatalog.getModel(modelId)?.display_name;
    },
  };
}
