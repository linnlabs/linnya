import { loadModelCatalog, type ModelCatalogGateway } from '../features/model-catalog';
import {
  activateModelPickerProviderModel,
  type ModelPickerGateway,
} from '../features/model-picker';

/**
 * 激活 Provider 目录模型会同时改变 Model Catalog 和 Model Picker 两个 read model。
 * 这个流程属于 domain 级编排，不能只更新发起操作的 picker feature。
 */
export async function activateConfiguredProviderModel(
  configuredProviderId: string,
  providerModelId: string,
  modelCatalogGateway?: ModelCatalogGateway,
  modelPickerGateway?: ModelPickerGateway
): Promise<void> {
  await activateModelPickerProviderModel(
    configuredProviderId,
    providerModelId,
    modelPickerGateway
  );
  await loadModelCatalog(modelCatalogGateway);
}
