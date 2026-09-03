import type {
  ProviderOnboardingRuntimeBinding,
  ResolvedProviderOnboardingModelRuntimeBinding,
} from '../definitions/providerOnboardingRuntimeBinding';

/** 只按私有 manifest 的显式模型覆盖解析 route，不读取模型名称或 URL 猜协议。 */
export function resolveProviderOnboardingModelRuntimeBinding(
  binding: ProviderOnboardingRuntimeBinding,
  providerModelId: string
): ResolvedProviderOnboardingModelRuntimeBinding {
  const modelBinding = binding.model_route_bindings?.find(
    candidate => candidate.model_id === providerModelId
  );
  return {
    provider_definition_id: binding.provider_definition_id,
    provider_connection_definition_id: binding.provider_connection_definition_id,
    endpoint_id: binding.endpoint_id,
    base_url: modelBinding?.base_url ?? binding.default_base_url,
    auth_profile: binding.auth_profile,
    route_profile_id: modelBinding?.route_profile_id ?? binding.default_route_profile_id,
  };
}
