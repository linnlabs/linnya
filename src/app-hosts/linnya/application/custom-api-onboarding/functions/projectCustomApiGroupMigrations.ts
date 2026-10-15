import type { CustomApiGroupMigration, ModelConfig } from 'src/domains/model-catalog';
import { readCustomApiProviderName } from './readCustomApiProviderName';

/** 正式归属已恢复后才投影；同协议、同 URL 或缺少 Provider 目录都不是改写归属的理由。 */
export function projectCustomApiGroupMigrations(
  models: readonly ModelConfig[],
  isFormalProviderModel: (modelId: string) => boolean
): CustomApiGroupMigration[] {
  const groups = new Map<string, string[]>();
  for (const model of models) {
    if (model.catalog_source !== 'user' || isFormalProviderModel(model.id)) continue;
    const name = readCustomApiProviderName(model);
    const modelIds = groups.get(name) ?? [];
    modelIds.push(model.id);
    groups.set(name, modelIds);
  }
  return Array.from(groups, ([name, model_ids]) => ({ name, model_ids }));
}
