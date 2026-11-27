import type { PluginModelConfigurationPort } from '@linnya/plugin-host-contract/backend/modelConfiguration';
import { getDefaultModelIdByCapability, modelCatalog } from 'src/domains/model-catalog';

export type * from '@linnya/plugin-host-contract/backend/modelConfiguration';

export function getPluginModelConfigurationPort(): PluginModelConfigurationPort {
  return {
    readDefaultModelIdByCapability: getDefaultModelIdByCapability,
    // 功能默认模型原先只由 Linnya Cloud 目录下发；客户端不再拉取 Cloud 目录后 Host 没有任何
    // 功能默认可发布。合同方法保留给知识库等调用方按“没有默认”处理，去留随调用方一起决定。
    readAuxiliaryModelBinding: () => undefined,
    getModelDisplayName(modelId) {
      return modelCatalog.getModel(modelId)?.display_name;
    },
  };
}
