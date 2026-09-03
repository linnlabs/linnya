import type {
  InferenceAuthProfile,
  LanguageInferenceRouteProfileId,
} from '@app/schemas/model-inference';

/**
 * Host 私有生成投影。它与公开目录共享 generation，但不从 Provider Catalog 根入口导出。
 * Provider 页面不得读取这些字段。
 */
export interface ProviderRuntimeBinding {
  readonly provider_definition_id: string;
  readonly provider_connection_definition_id: string;
  readonly endpoint_id: string;
  readonly default_base_url: string;
  readonly auth_profile: InferenceAuthProfile;
  readonly default_route_profile_id: LanguageInferenceRouteProfileId;
  readonly supported_route_profile_ids: readonly LanguageInferenceRouteProfileId[];
  readonly model_route_bindings?: readonly ProviderModelRuntimeBinding[];
  /** 仅供同步 diff 审阅；运行时不得据此选择 package 或 URL。 */
  readonly source_catalog_observation: {
    readonly package_name: string;
    readonly api_url?: string;
  };
}

/** 聚合型 Provider 中，模型对默认 route 的显式覆盖；不进入公开目录。 */
export interface ProviderModelRuntimeBinding {
  readonly model_id: string;
  readonly base_url: string;
  readonly route_profile_id: LanguageInferenceRouteProfileId;
}

export interface ProviderRuntimeBindingSnapshot {
  readonly schema_version: 2;
  readonly generation_id: string;
  readonly source_sha256: string;
  readonly bindings: readonly ProviderRuntimeBinding[];
}
