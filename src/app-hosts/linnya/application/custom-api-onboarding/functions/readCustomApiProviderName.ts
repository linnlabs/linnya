import type { ModelConfig } from 'src/domains/model-catalog';

/** 未填写分组名称的历史自定义模型统一归入该分组；它是投影身份，不是 Provider 实体。 */
export const DEFAULT_CUSTOM_API_PROVIDER_NAME = '自定义模型';

/** 自定义模型分组身份的唯一规则，模型选择投影与分组编辑必须共用。 */
export function readCustomApiProviderName(
  model: Pick<ModelConfig, 'custom_provider_name'>
): string {
  return model.custom_provider_name?.trim() || DEFAULT_CUSTOM_API_PROVIDER_NAME;
}
