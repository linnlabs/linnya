import type { ModelConfig } from 'src/domains/model-catalog';
import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';
import { readCustomApiProviderName } from './readCustomApiProviderName';

export function selectCustomApiProviderModels(
  providerName: string,
  models: readonly ModelConfig[],
  isFormalProviderModel: (modelId: string) => boolean
): ModelConfig[] {
  const selected = models.filter(
    model =>
      model.catalog_source === 'user' &&
      !isFormalProviderModel(model.id) &&
      readCustomApiProviderName(model) === providerName
  );
  if (selected.length === 0)
    throw new CustomApiOnboardingError(
      'custom_api_onboarding.provider_not_found',
      '自定义模型分组不存在或已被删除',
      404
    );
  return selected;
}
