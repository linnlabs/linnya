import { findLanguageInferenceRouteProfile } from '@app/schemas/model-inference';

import type {
  AiSdkFactoryAdmissionDescriptor,
  FormalProviderRuntimeAdmissionInput,
} from '../definitions/runtimeManifestAdmission';

/**
 * 在 Host composition 边界核对“正式 Provider manifest → canonical route → package factory”。
 *
 * 生成资产决定哪些正式 route 必须可用；本函数只核对 Linnya 已审核的 factory 声明，
 * 不读取 models.dev 的 package 建议，也不按 Provider 名称或 URL 猜测实现。
 */
export function assertFormalProviderRuntimeManifestCovered(
  input: FormalProviderRuntimeAdmissionInput
): void {
  const factoriesByCapability = new Map<
    AiSdkFactoryAdmissionDescriptor['capability_id'],
    AiSdkFactoryAdmissionDescriptor
  >();

  for (const factory of input.factories) {
    if (factoriesByCapability.has(factory.capability_id)) {
      throw new Error(`重复的 AI SDK package factory: ${factory.capability_id}`);
    }
    factoriesByCapability.set(factory.capability_id, factory);
  }

  for (const binding of input.bindings) {
    for (const profileId of binding.supported_route_profile_ids) {
      const profile = findLanguageInferenceRouteProfile(profileId);
      const factory = factoriesByCapability.get(profile.capability_id);
      if (!factory) {
        throw new Error(
          `Provider ${binding.provider_definition_id} 的 ${profile.id} route 缺少 AI SDK package factory`
        );
      }
      if (factory.surface !== profile.api_surface) {
        throw new Error(
          `Provider ${binding.provider_definition_id} 的 ${profile.id} route 与 factory surface 不一致`
        );
      }
      if (!factory.auth_profiles.includes(binding.auth_profile)) {
        throw new Error(
          `Provider ${binding.provider_definition_id} 的 ${profile.id} route 与 factory auth profile 不一致`
        );
      }
    }
  }
}
