import type {
  ProviderOnboardingRuntimeBinding,
  ProviderOnboardingRuntimeBindingRegistry,
} from '../definitions/providerOnboardingRuntimeBinding';
import { formalProviderRuntimeManifestRegistry } from '@linnya/provider-catalog/runtime-bindings';

function projectOnboardingBinding(
  providerConnectionDefinitionId: string
): ProviderOnboardingRuntimeBinding | undefined {
  const binding = formalProviderRuntimeManifestRegistry.get(providerConnectionDefinitionId);
  if (!binding) return undefined;

  return Object.freeze({
    provider_definition_id: binding.provider_definition_id,
    provider_connection_definition_id: binding.provider_connection_definition_id,
    endpoint_id: binding.endpoint_id,
    default_base_url: binding.default_base_url,
    auth_profile: binding.auth_profile,
    default_route_profile_id: binding.default_route_profile_id,
    ...(binding.model_route_bindings
      ? {
          model_route_bindings: binding.model_route_bindings.map(modelBinding => ({
            ...modelBinding,
          })),
        }
      : {}),
  });
}

export const providerOnboardingRuntimeBindingRegistry: ProviderOnboardingRuntimeBindingRegistry =
  Object.freeze({
    generation_id: formalProviderRuntimeManifestRegistry.generation_id,
    source_sha256: formalProviderRuntimeManifestRegistry.source_sha256,
    get: projectOnboardingBinding,
  });
