import type { ModelConfig } from '../../../definitions/modelCatalog';

/** 写盘期间账号/Cloud 投影可能改变；仅应用本事务的差异，不覆盖其他来源的最新事实。 */
export function applyCommittedModelChanges(
  current: ReadonlyMap<string, ModelConfig>,
  previous: ReadonlyMap<string, ModelConfig>,
  next: ReadonlyMap<string, ModelConfig>,
): Map<string, ModelConfig> {
  const committed = new Map(current);
  for (const id of previous.keys()) {
    if (!next.has(id)) committed.delete(id);
  }
  for (const [id, model] of next) {
    if (previous.get(id) !== model) committed.set(id, model);
  }
  return committed;
}
