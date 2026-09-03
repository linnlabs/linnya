import type {
  InferenceAuthProfile,
  LanguageInferenceRouteProfileId,
} from '@app/schemas/model-inference';

/**
 * 正式 Provider 已通过发布准入的 Host 运行时绑定。
 *
 * 这里只保留 Host 真正执行和验证所需的字段。models.dev 的 package/API 观察值
 * 在读取生成资产时被丢弃，不能越过 admission 成为运行时选择依据。
 */
export interface FormalProviderRuntimeBinding {
  readonly provider_definition_id: string;
  readonly provider_connection_definition_id: string;
  readonly endpoint_id: string;
  readonly default_base_url: string;
  readonly auth_profile: InferenceAuthProfile;
  readonly default_route_profile_id: LanguageInferenceRouteProfileId;
  readonly supported_route_profile_ids: readonly LanguageInferenceRouteProfileId[];
  readonly model_route_bindings?: readonly FormalProviderModelRuntimeBinding[];
}

export interface FormalProviderModelRuntimeBinding {
  readonly model_id: string;
  readonly base_url: string;
  readonly route_profile_id: LanguageInferenceRouteProfileId;
}

export interface FormalProviderRuntimeManifestSnapshot {
  readonly generation_id: string;
  readonly source_sha256: string;
  readonly bindings: readonly FormalProviderRuntimeBinding[];
}

export interface FormalProviderRuntimeManifestRegistry
  extends FormalProviderRuntimeManifestSnapshot {
  get(providerConnectionDefinitionId: string): FormalProviderRuntimeBinding | undefined;
}
