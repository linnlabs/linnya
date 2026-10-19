import type { ProviderConfigurationSnapshot } from '../../definitions/providerConfiguration';

export function assertUniqueSnapshot(snapshot: ProviderConfigurationSnapshot): void {
  const providerIds = new Set<string>();
  const providerConnectionDefinitionIds = new Set<string>();
  const modelConfigIds = new Set<string>();
  const intentIds = new Set<string>();

  for (const provider of snapshot.configured_providers) {
    if (providerIds.has(provider.id)) throw new Error(`重复 ConfiguredProvider ID: ${provider.id}`);
    if (providerConnectionDefinitionIds.has(provider.provider_connection_definition_id)) {
      throw new Error(`重复正式 connection 配置: ${provider.provider_connection_definition_id}`);
    }
    providerIds.add(provider.id);
    providerConnectionDefinitionIds.add(provider.provider_connection_definition_id);
    const providerModelIds = new Set<string>();
    for (const model of provider.models) {
      if (providerModelIds.has(model.provider_model_id)) {
        throw new Error(`ConfiguredProvider ${provider.id} 重复模型: ${model.provider_model_id}`);
      }
      if (modelConfigIds.has(model.model_config_id)) {
        throw new Error(`ModelConfig 已关联多个正式 Provider: ${model.model_config_id}`);
      }
      providerModelIds.add(model.provider_model_id);
      modelConfigIds.add(model.model_config_id);
    }
  }
  for (const intent of [
    ...snapshot.pending_model_registrations,
    ...snapshot.pending_model_removals,
  ]) {
    if (intentIds.has(intent.id))
      throw new Error(`重复 Provider configuration intent: ${intent.id}`);
    intentIds.add(intent.id);
  }
}
