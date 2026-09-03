import { z } from 'zod';
import {
  findLanguageInferenceRouteProfile,
  LanguageInferenceRouteProfileIdSchema,
} from '@app/schemas/model-inference';

import type {
  FormalProviderRuntimeBinding,
  FormalProviderRuntimeManifestSnapshot,
} from '../definitions/formalProviderRuntimeManifest';

const RawBindingSchema = z
  .object({
    provider_definition_id: z.string().trim().min(1),
    provider_connection_definition_id: z.string().trim().min(1),
    endpoint_id: z.string().trim().min(1),
    default_base_url: z.string().url(),
    auth_profile: z.enum(['none', 'bearer', 'api_key']),
    default_route_profile_id: LanguageInferenceRouteProfileIdSchema,
    supported_route_profile_ids: z.array(LanguageInferenceRouteProfileIdSchema).min(1),
    model_route_bindings: z
      .array(
        z
          .object({
            model_id: z.string().trim().min(1),
            base_url: z.string().url(),
            route_profile_id: LanguageInferenceRouteProfileIdSchema,
          })
          .strict()
      )
      .optional(),
    source_catalog_observation: z
      .object({
        package_name: z.string().trim().min(1),
        api_url: z.string().url().optional(),
      })
      .strict(),
  })
  .strict();

const RawSnapshotSchema = z
  .object({
    schema_version: z.literal(2),
    generation_id: z.string().trim().min(1),
    source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bindings: z.array(RawBindingSchema),
  })
  .strict();

/** 严格读取 Host 私有生成资产，并在进入运行时 manifest 前删除同步期观察字段。 */
export function readFormalProviderRuntimeManifestSnapshot(
  value: unknown
): FormalProviderRuntimeManifestSnapshot {
  const snapshot = RawSnapshotSchema.parse(value);
  const connectionIds = new Set<string>();
  const bindings = snapshot.bindings.map((binding): FormalProviderRuntimeBinding => {
    if (connectionIds.has(binding.provider_connection_definition_id)) {
      throw new Error(
        `重复的 Provider connection runtime binding: ${binding.provider_connection_definition_id}`
      );
    }
    connectionIds.add(binding.provider_connection_definition_id);

    const supportedProfileIds = new Set(binding.supported_route_profile_ids);
    if (supportedProfileIds.size !== binding.supported_route_profile_ids.length) {
      throw new Error(
        `Provider ${binding.provider_definition_id} 包含重复的 supported route profile`
      );
    }
    if (!supportedProfileIds.has(binding.default_route_profile_id)) {
      throw new Error(
        `Provider ${binding.provider_definition_id} 的默认 route profile 不在支持列表中`
      );
    }

    for (const profileId of binding.supported_route_profile_ids) {
      const profile = findLanguageInferenceRouteProfile(profileId);
      if (!(profile.auth_profiles as readonly string[]).includes(binding.auth_profile)) {
        throw new Error(
          `Provider ${binding.provider_definition_id} 的 auth profile 与 ${profile.id} route profile 不一致`
        );
      }
    }

    const modelIds = new Set<string>();
    for (const modelBinding of binding.model_route_bindings ?? []) {
      if (modelIds.has(modelBinding.model_id)) {
        throw new Error(
          `Provider ${binding.provider_definition_id} 包含重复的模型 route binding: ${modelBinding.model_id}`
        );
      }
      modelIds.add(modelBinding.model_id);
      if (!supportedProfileIds.has(modelBinding.route_profile_id)) {
        throw new Error(
          `Provider ${binding.provider_definition_id} 的模型 ${modelBinding.model_id} 使用了未声明支持的 route profile`
        );
      }
    }

    return Object.freeze({
      provider_definition_id: binding.provider_definition_id,
      provider_connection_definition_id: binding.provider_connection_definition_id,
      endpoint_id: binding.endpoint_id,
      default_base_url: binding.default_base_url.replace(/\/+$/, ''),
      auth_profile: binding.auth_profile,
      default_route_profile_id: binding.default_route_profile_id,
      supported_route_profile_ids: Object.freeze([...binding.supported_route_profile_ids]),
      ...(binding.model_route_bindings
        ? {
            model_route_bindings: Object.freeze(
              binding.model_route_bindings.map(modelBinding =>
                Object.freeze({
                  ...modelBinding,
                  base_url: modelBinding.base_url.replace(/\/+$/, ''),
                })
              )
            ),
          }
        : {}),
    });
  });

  return Object.freeze({
    generation_id: snapshot.generation_id,
    source_sha256: snapshot.source_sha256,
    bindings: Object.freeze(bindings),
  });
}
