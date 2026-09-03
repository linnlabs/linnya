import { deleteModelFromCatalog, type ModelCatalogGateway } from '../features/model-catalog';
import { loadModelPicker, type ModelPickerGateway } from '../features/model-picker';
import { clearBindingsForModel } from '../features/purpose-model-bindings';

/** 删除目录实体后清理所有显式用途绑定，避免持久化悬空 ID。 */
export async function deleteConfiguredModel(
  modelId: string,
  gateway?: ModelCatalogGateway,
  modelPickerGateway?: ModelPickerGateway
): Promise<void> {
  await deleteModelFromCatalog(modelId, gateway);
  clearBindingsForModel(modelId);
  await loadModelPicker(modelPickerGateway);
}
