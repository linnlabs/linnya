import type { ModelSourceRemovalResult } from '../definitions/modelSourceRemoval';
import { deleteModelFromCatalog, type ModelCatalogGateway } from '../features/model-catalog';
import {
  loadModelPicker,
  removeCommittedModelsFromPicker,
  type ModelPickerGateway,
} from '../features/model-picker';
import { clearBindingsForModel } from '../features/purpose-model-bindings';

/** 正式 Provider 的每个归属删除仍走 Host durable intent；整批结束后再同步一次列表。 */
export async function removeModelSource(
  modelConfigIds: readonly string[],
  catalogGateway?: ModelCatalogGateway,
  pickerGateway?: ModelPickerGateway
): Promise<ModelSourceRemovalResult> {
  const removedModelIds: string[] = [];
  let failure: ModelSourceRemovalResult['failure'] = null;
  for (const modelId of modelConfigIds) {
    try {
      await deleteModelFromCatalog(modelId, catalogGateway);
      clearBindingsForModel(modelId);
      removedModelIds.push(modelId);
    } catch (error: unknown) {
      failure = { modelId, error };
      break;
    }
  }
  await removeCommittedModelsFromPicker(removedModelIds);
  let synchronizationFailed = false;
  try {
    await loadModelPicker(pickerGateway);
  } catch {
    // 已提交的删除不能被一次读取失败改写成失败，Picker 保留自己的 load 错误。
    synchronizationFailed = true;
  }
  return { removedModelIds, failure, synchronizationFailed };
}
