import type { ModelCatalogItem } from '../definitions/modelCatalog';

/** Host 删除回执是正式事实，即使投影重读失败也不能继续提供已删除模型。 */
export function removeCommittedCatalogModels(
  models: readonly ModelCatalogItem[],
  removedModelIds: readonly string[]
): ModelCatalogItem[] {
  const removed = new Set(removedModelIds);
  return models.filter(model => !removed.has(model.id));
}
