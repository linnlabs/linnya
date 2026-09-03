import type {
  InferenceAuthProfile,
  LanguageInferenceRouteProfileId,
} from '@app/schemas/model-inference';

/**
 * 正式 Provider onboarding 可消费的最小运行时绑定。
 *
 * package 名称和上游目录观察值刻意不进入此合同：工作流只需知道已经验收的
 * route profile，真实 package factory 仍由 inference capability registry 独占。
 */
export interface ProviderOnboardingRuntimeBinding {
  readonly provider_definition_id: string;
  readonly provider_connection_definition_id: string;
  readonly endpoint_id: string;
  readonly default_base_url: string;
  readonly auth_profile: InferenceAuthProfile;
  readonly default_route_profile_id: LanguageInferenceRouteProfileId;
  readonly model_route_bindings?: readonly ProviderOnboardingModelRuntimeBinding[];
}

export interface ProviderOnboardingModelRuntimeBinding {
  readonly model_id: string;
  readonly base_url: string;
  readonly route_profile_id: LanguageInferenceRouteProfileId;
}

export interface ResolvedProviderOnboardingModelRuntimeBinding {
  readonly provider_definition_id: string;
  readonly provider_connection_definition_id: string;
  readonly endpoint_id: string;
  readonly base_url: string;
  readonly auth_profile: InferenceAuthProfile;
  readonly route_profile_id: LanguageInferenceRouteProfileId;
}

export interface ProviderOnboardingRuntimeBindingRegistry {
  readonly generation_id: string;
  readonly source_sha256: string;
  get(providerConnectionDefinitionId: string): ProviderOnboardingRuntimeBinding | undefined;
}
