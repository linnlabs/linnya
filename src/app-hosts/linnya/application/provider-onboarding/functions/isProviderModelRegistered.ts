import type { ConfiguredProvider } from 'src/domains/provider-configuration';

/** Provider 模型归属是唯一事实，不能通过重复 ModelConfig 表达多次启用。 */
export function isProviderModelRegistered(
  provider: ConfiguredProvider | undefined,
  providerModelId: string
): boolean {
  return provider?.models.some(model => model.provider_model_id === providerModelId) ?? false;
}
