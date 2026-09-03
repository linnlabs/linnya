import type {
  InferenceAuthProfile,
  LanguageInferenceRouteProfileId,
} from '@app/schemas/model-inference';
import type {
  ProviderKind,
  ProviderModelDiscoveryKind,
  ProviderModelDefinition,
  ProviderReleaseStatus,
  ProviderSetupField,
} from '../../../definitions/providerCatalog';

export interface ProviderAdmissionPolicy {
  readonly source_provider_id?: string;
  readonly provider_definition_id: string;
  /** 省略时与 provider_definition_id 相同，只用于单 connection 品牌。 */
  readonly provider_connection_definition_id?: string;
  readonly display_name: string;
  /** 省略时与 display_name 相同，只用于单 connection 品牌。 */
  readonly connection_display_name?: string;
  readonly connection_description?: string;
  readonly connection_badge?: string;
  readonly setup_help_url?: string;
  readonly kind: ProviderKind;
  readonly release_status: ProviderReleaseStatus;
  readonly setup_fields: readonly ProviderSetupField[];
  readonly model_discovery: ProviderModelDiscoveryKind;
  /**
   * models.dev 不拥有的正式产品模型清单。
   *
   * 这里只接收已经过来源审计的窄投影，不能复制第三方运行时或请求 codec。
   */
  readonly bundled_models?: readonly ProviderModelDefinition[];
  readonly model_admission?: {
    /** Agent Provider 首批目录可要求上游明确声明工具调用，避免混入 embedding/TTS 等模型。 */
    readonly requires_tool_call?: true;
  };
  readonly runtime_binding?: {
    readonly endpoint_id: string;
    readonly default_base_url: string;
    readonly auth_profile: InferenceAuthProfile;
    readonly default_route_profile_id: LanguageInferenceRouteProfileId;
    readonly supported_route_profile_ids: readonly LanguageInferenceRouteProfileId[];
    readonly model_route_bindings?: readonly {
      readonly model_id: string;
      readonly base_url: string;
      readonly route_profile_id: LanguageInferenceRouteProfileId;
    }[];
  };
  /** 仅供生成资产 diff 和来源审计，不参与运行时选路。 */
  readonly source_catalog_observation?: {
    readonly package_name: string;
    readonly api_url?: string;
  };
}
