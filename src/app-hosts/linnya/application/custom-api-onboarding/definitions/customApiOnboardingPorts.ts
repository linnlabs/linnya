import type {
  CustomApiProviderRemovalCommand,
  CustomApiProviderRemovalResponse,
  CustomApiModelRegistrationCommand,
  CustomApiModelRegistrationResponse,
  CustomApiProviderUpdateCommand,
  CustomApiProviderUpdateResponse,
  CustomApiProviderRefreshCommand,
  CustomApiProviderRefreshResponse,
} from '@app/schemas/custom-api-onboarding';
import type {
  InferenceEndpointSelection,
  InferenceEndpointView,
  ModelConfig,
  ModelDiff,
  ModelDiscoveryService,
  UserModelRegistration,
} from 'src/domains/model-catalog';
import type { ModelPickerModelPreference } from 'src/domains/model-picker-preferences';
import type { ConfiguredProvider } from 'src/domains/provider-configuration';

export interface CustomApiOnboardingModelCatalogPort {
  getModels(): ModelConfig[];
  getInferenceEndpoints(): InferenceEndpointView[];
  resolveCredential(modelId: string): string | undefined;
  getUserRevision(): number;
  applyDiff(diff: ModelDiff, expectedRevision: number): Promise<void>;
  registerUserModels(
    registrations: readonly UserModelRegistration[],
    expectedRevision: number
  ): Promise<void>;
  rebindUserModels(
    models: readonly ModelConfig[],
    endpoint: InferenceEndpointSelection,
    expectedRevision: number
  ): Promise<void>;
}

/** 正式 Provider（含 Ollama 本地）的模型同为用户目录条目，但不属于自定义分组。 */
export interface CustomApiOnboardingProviderMembershipPort {
  getByModelConfigId(modelConfigId: string): ConfiguredProvider | undefined;
}

export interface CustomApiOnboardingPreferencesPort {
  removeModelPreferences(modelIds: readonly string[]): Promise<void>;
  setModelVisibilities(preferences: readonly ModelPickerModelPreference[]): Promise<void>;
}

export interface CustomApiOnboardingIdFactory {
  create(): string;
}

export interface CustomApiOnboardingUseCase {
  removeProvider(
    command: CustomApiProviderRemovalCommand
  ): Promise<CustomApiProviderRemovalResponse>;
  refreshProvider(
    command: CustomApiProviderRefreshCommand
  ): Promise<CustomApiProviderRefreshResponse>;
  registerModel(
    command: CustomApiModelRegistrationCommand
  ): Promise<CustomApiModelRegistrationResponse>;
  /** 整体替换一个自定义模型分组的名称、地址、格式，并可选为该分组更换 Key。 */
  updateProvider(command: CustomApiProviderUpdateCommand): Promise<CustomApiProviderUpdateResponse>;
}

export interface CustomApiOnboardingDependencies {
  readonly modelCatalog: CustomApiOnboardingModelCatalogPort;
  readonly providerMembership: CustomApiOnboardingProviderMembershipPort;
  readonly modelPickerPreferences: CustomApiOnboardingPreferencesPort;
  readonly modelDiscovery: Pick<ModelDiscoveryService, 'discover'>;
  readonly idFactory: CustomApiOnboardingIdFactory;
}
