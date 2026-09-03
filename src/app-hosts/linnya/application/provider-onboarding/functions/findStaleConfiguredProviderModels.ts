import type { ProviderModelDefinition } from '@linnya/provider-catalog';
import type {
  ConfiguredProvider,
  ConfiguredProviderModel,
} from 'src/domains/provider-configuration';

/** 账户目录是账号型 Provider 的模型集合真相，未再出现的本地关联需要退出。 */
export function findStaleConfiguredProviderModels(
  configuredProvider: ConfiguredProvider | undefined,
  discoveredModels: readonly ProviderModelDefinition[]
): readonly ConfiguredProviderModel[] {
  if (!configuredProvider) return [];
  const discoveredModelIds = new Set(discoveredModels.map(model => model.id));
  return configuredProvider.models.filter(
    model => !discoveredModelIds.has(model.provider_model_id)
  );
}
