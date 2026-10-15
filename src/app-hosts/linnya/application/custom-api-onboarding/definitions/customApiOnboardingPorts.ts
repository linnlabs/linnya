import type {
  CustomApiModelRegistrationCommand,
  CustomApiModelRegistrationResponse,
  CustomApiProviderUpdateCommand,
  CustomApiProviderUpdateResponse,
} from '@app/schemas/custom-api-onboarding';
import type {
  InferenceEndpointSelection,
  InferenceEndpointView,
  ModelConfig,
} from 'src/domains/model-catalog';
import type { ConfiguredProvider } from 'src/domains/provider-configuration';

export interface CustomApiOnboardingModelCatalogPort {
  getModels(): ModelConfig[];
  getInferenceEndpoints(): InferenceEndpointView[];
  registerUserModel(model: ModelConfig, endpoint: InferenceEndpointSelection): Promise<void>;
  rebindUserModels(
    models: readonly ModelConfig[],
    endpoint: InferenceEndpointSelection
  ): Promise<void>;
}

/** 正式 Provider（含 Ollama 本地）的模型同为用户目录条目，但不属于自定义分组。 */
export interface CustomApiOnboardingProviderMembershipPort {
  getByModelConfigId(modelConfigId: string): ConfiguredProvider | undefined;
}

export interface CustomApiOnboardingPreferencesPort {
  setModelVisibility(modelConfigId: string, visible: boolean): Promise<void>;
}

export interface CustomApiOnboardingIdFactory {
  create(): string;
}

export interface CustomApiOnboardingUseCase {
  registerModel(
    command: CustomApiModelRegistrationCommand
  ): Promise<CustomApiModelRegistrationResponse>;
  /** 整体替换一个自定义模型分组的名称、地址、格式，并可选为该分组更换 Key。 */
  updateProvider(command: CustomApiProviderUpdateCommand): Promise<CustomApiProviderUpdateResponse>;
}
