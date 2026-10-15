import type { ModelConfig } from 'src/domains/model-catalog';
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
  return selected;
}
