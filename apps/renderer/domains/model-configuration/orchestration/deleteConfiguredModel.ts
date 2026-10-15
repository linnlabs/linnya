import type { ModelCatalogGateway } from '../features/model-catalog';
import type { ModelPickerGateway } from '../features/model-picker';
import { removeModelSource } from './removeModelSource';

/** 单模型与整组共享提交边界：只将真正的删除失败抛给详情界面。 */
export async function deleteConfiguredModel(
  modelId: string,
  gateway?: ModelCatalogGateway,
  modelPickerGateway?: ModelPickerGateway
): Promise<void> {
  const result = await removeModelSource([modelId], gateway, modelPickerGateway);
  if (result.failure) throw result.failure.error;
}
