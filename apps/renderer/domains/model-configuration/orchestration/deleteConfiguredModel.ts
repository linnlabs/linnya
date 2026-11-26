import type { ModelCatalogGateway } from '../features/model-catalog';
import type { ModelPickerGateway } from '../features/model-picker';
import { removeModelSource } from './removeModelSource';

/** 单模型与整组共享提交边界：只将真正的删除失败抛给详情界面。 */
export async function deleteConfiguredModel(
  modelId: string,
  gateway?: ModelCatalogGateway,
  modelPickerGateway?: ModelPickerGateway
): Promise<void> {
  const result = await removeModelSource(
    { modelConfigIds: [modelId], unadmittedModelConfigIds: [] },
    gateway,
    modelPickerGateway
  );
  if (result.failure) throw result.failure.error;
}

/** 删除启动时停用的条目（设置页“配置无效”列表）；与单模型删除同一条后端用例，只是前端没有 catalog 条目可移除。 */
export async function deleteUnadmittedModel(
  modelId: string,
  gateway?: ModelCatalogGateway,
  modelPickerGateway?: ModelPickerGateway
): Promise<void> {
  const result = await removeModelSource(
    { modelConfigIds: [], unadmittedModelConfigIds: [modelId] },
    gateway,
    modelPickerGateway
  );
  if (result.failure) throw result.failure.error;
}
