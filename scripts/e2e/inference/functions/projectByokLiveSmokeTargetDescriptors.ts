import { findLanguageInferenceRouteProfile } from '@app/schemas/model-inference';

import type { FormalProviderRuntimeBinding } from '@linnya/provider-catalog/runtime-bindings';
import type { ByokLiveSmokeTargetDescriptor } from '../definitions/byokLiveSmoke';

function environmentSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function profileQualifier(providerDefinitionId: string, profileId: string): string {
  const providerPrefix = `${providerDefinitionId}_`;
  return profileId.startsWith(providerPrefix) ? profileId.slice(providerPrefix.length) : profileId;
}

/** 从正式 Provider manifest 投影 live smoke/readiness 目标，不维护厂商清单副本。 */
export function projectByokLiveSmokeTargetDescriptors(
  bindings: readonly FormalProviderRuntimeBinding[]
): readonly ByokLiveSmokeTargetDescriptor[] {
  const descriptors = bindings.flatMap(binding => {
    if (binding.auth_profile === 'none') {
      throw new Error(
        `Provider ${binding.provider_definition_id} 没有凭据，不能进入 BYOK live smoke`
      );
    }

    const endpointSegment = environmentSegment(binding.endpoint_id);
    const hasMultipleProfiles = binding.supported_route_profile_ids.length > 1;
    return binding.supported_route_profile_ids.map(profileId => {
      const profile = findLanguageInferenceRouteProfile(profileId);
      const qualifier = profileQualifier(binding.provider_definition_id, profile.id);
      const targetId = hasMultipleProfiles
        ? `${binding.endpoint_id}-${qualifier.replace(/_/g, '-')}`
        : binding.endpoint_id;
      const modelSegment = hasMultipleProfiles
        ? `${endpointSegment}_${environmentSegment(qualifier)}`
        : endpointSegment;

      return Object.freeze({
        id: targetId,
        name: `${binding.provider_definition_id} / ${profile.id}`,
        capability_id: profile.capability_id,
        surface: profile.api_surface,
        endpoint_id: binding.endpoint_id,
        auth_profile: binding.auth_profile,
        credentialEnvironmentVariable: `LINNYA_BYOK_${endpointSegment}_API_KEY`,
        modelEnvironmentVariable: `LINNYA_BYOK_${modelSegment}_MODEL`,
        baseUrlEnvironmentVariable: `LINNYA_BYOK_${endpointSegment}_BASE_URL`,
        defaultBaseUrl: binding.default_base_url,
      });
    });
  });
  const duplicateIds = descriptors
    .map(descriptor => descriptor.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    throw new Error(`BYOK live smoke target id 重复：${[...new Set(duplicateIds)].join(', ')}`);
  }
  return Object.freeze(descriptors);
}
