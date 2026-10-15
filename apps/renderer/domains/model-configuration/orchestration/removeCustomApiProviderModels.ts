import {
  removeCustomApiProvider,
  type CustomApiProviderRemovalGateway,
} from '../features/custom-model-registration';
import {
  loadModelCatalog,
  removeCommittedModelsFromCatalog,
  type ModelCatalogGateway,
} from '../features/model-catalog';
import {
  loadModelPicker,
  removeCommittedCustomProviderFromPicker,
  type ModelPickerGateway,
} from '../features/model-picker';
import { clearBindingsForModel } from '../features/purpose-model-bindings';

/** 提交删除后先清理用途绑定；投影重读失败单独报告，不能把成功删除说成失败。 */
export async function removeCustomApiProviderModels(
  providerName: string,
  gateway?: CustomApiProviderRemovalGateway,
  catalogGateway?: ModelCatalogGateway,
  pickerGateway?: ModelPickerGateway
): Promise<{ synchronizationFailed: boolean }> {
  const result = await removeCustomApiProvider(providerName, gateway);
  for (const modelId of result.removed_model_ids) clearBindingsForModel(modelId);
  await Promise.all([
    removeCommittedModelsFromCatalog(result.removed_model_ids),
    removeCommittedCustomProviderFromPicker(providerName, result.removed_model_ids),
  ]);
  const reads = await Promise.allSettled([
    loadModelCatalog(catalogGateway),
    loadModelPicker(pickerGateway),
  ]);
  return { synchronizationFailed: reads.some(read => read.status === 'rejected') };
}
