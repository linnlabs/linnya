import type {
  ModelSourceRemovalResult,
  ModelSourceRemovalTargets,
} from '../definitions/modelSourceRemoval';
import {
  deleteModelFromCatalog,
  deleteUnadmittedModelFromCatalog,
} from '../features/model-catalog/orchestration/modelCatalogOperations';
import type { ModelCatalogGateway } from '../features/model-catalog/definitions/modelCatalogGateway';
import {
  loadModelPicker,
  removeCommittedModelsFromPicker,
  type ModelPickerGateway,
} from '../features/model-picker';
import { clearBindingsForModel } from '../features/purpose-model-bindings/orchestration/modelPurposeBindings';

/** 正式 Provider 的每个归属删除仍走 Host durable intent；整批结束后再同步一次列表。 */
export async function removeModelSource(
  targets: ModelSourceRemovalTargets,
  catalogGateway?: ModelCatalogGateway,
  pickerGateway?: ModelPickerGateway
): Promise<ModelSourceRemovalResult> {
  const removedModelIds: string[] = [];
  let failure: ModelSourceRemovalResult['failure'] = null;
  const steps = [
    ...targets.modelConfigIds.map(modelId => ({ modelId, unadmitted: false })),
    ...targets.unadmittedModelConfigIds.map(modelId => ({ modelId, unadmitted: true })),
  ];
  for (const { modelId, unadmitted } of steps) {
    try {
      if (unadmitted) {
        // 停用条目不可选、不进用途绑定，只删后端；选择器快照在下面按回执一并移除。
        await deleteUnadmittedModelFromCatalog(modelId, catalogGateway);
      } else {
        await deleteModelFromCatalog(modelId, catalogGateway);
        clearBindingsForModel(modelId);
      }
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
