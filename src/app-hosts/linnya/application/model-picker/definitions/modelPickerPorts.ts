import type { ModelPickerSnapshot } from '@app/schemas/model-picker';
import type {
  DirectProviderModelRegistrationCommand,
  DirectProviderModelRegistrationResponse,
} from '@app/schemas/provider-onboarding';
import type {
  EndpointCredentialStatus,
  InferenceEndpointView,
  ModelConfig,
  CustomApiGroup,
  UnadmittedUserModel,
} from 'src/domains/model-catalog';
import type { ProviderCatalog, ProviderDefinition } from '@linnya/provider-catalog';
import type { ConfiguredProvider } from 'src/domains/provider-configuration';
import type { ModelPickerPreferencesSnapshot } from 'src/domains/model-picker-preferences';
import type {
  ProviderAccount,
  ProviderAccountCredentialStatus,
} from 'src/domains/provider-account';
import type { ProviderModelDiscoveryReadPort } from '../../provider-model-discovery';

export interface ModelPickerModelCatalogPort {
  getModels(): ModelConfig[];
  /** 启动时停用的用户模型；设置页单独列出，不能当作可启用的候选。 */
  getUnadmittedUserModels(): readonly UnadmittedUserModel[];
  getModel(modelConfigId: string): ModelConfig | undefined;
  getInferenceEndpoints(): InferenceEndpointView[];
  getCustomApiGroups(): readonly CustomApiGroup[];
  hasCredential(modelConfigId: string): boolean;
  getCredentialStatus(modelConfigId: string): EndpointCredentialStatus | 'missing';
}

export type ModelPickerProviderCatalogPort = Pick<ProviderCatalog, 'list' | 'getConnection'>;

export interface ModelPickerProviderConfigurationPort {
  list(): readonly ConfiguredProvider[];
  getByModelConfigId(modelConfigId: string): ConfiguredProvider | undefined;
}

export interface ModelPickerProviderAccountPort {
  list(): readonly ProviderAccount[];
  hasCredential(accountId: string): boolean;
  getCredentialStatus(accountId: string): ProviderAccountCredentialStatus | 'missing';
}

export interface ModelPickerPreferencesPort {
  read(): ModelPickerPreferencesSnapshot;
  setProviderVisibility(configuredProviderId: string, visible: boolean): Promise<void>;
  setModelVisibility(modelConfigId: string, visible: boolean): Promise<void>;
}

/** 按 Provider 当前定义重建停用成员；只对能按定义修复的 connection 调用。 */
export interface ModelPickerProviderModelRepairPort {
  repairUnadmittedProviderModels(providerConnectionDefinitionId: string): Promise<unknown>;
}

export interface ModelPickerProviderModelActivationPort {
  registerDirectProviderModel(
    command: DirectProviderModelRegistrationCommand
  ): Promise<DirectProviderModelRegistrationResponse>;
}

export interface ComposeSelectableModelMenuInput {
  readonly discovered_models: Pick<ProviderModelDiscoveryReadPort, 'read'>;
  readonly can_refresh_models: (connectionId: string) => boolean;
  readonly provider_definitions: readonly ProviderDefinition[];
  readonly configured_providers: readonly ConfiguredProvider[];
  readonly models: readonly ModelConfig[];
  readonly unadmitted_models: readonly UnadmittedUserModel[];
  readonly inference_endpoints: readonly InferenceEndpointView[];
  readonly custom_api_groups: readonly CustomApiGroup[];
  readonly provider_accounts: readonly ProviderAccount[];
  readonly preferences: ModelPickerPreferencesSnapshot;
  readonly has_credential: (modelConfigId: string) => boolean;
  readonly has_provider_account_credential: (accountId: string) => boolean;
  readonly get_credential_status: (modelConfigId: string) => EndpointCredentialStatus | 'missing';
  readonly get_provider_account_credential_status: (
    accountId: string
  ) => ProviderAccountCredentialStatus | 'missing';
}

export interface ModelPickerUseCase {
  read(): ModelPickerSnapshot;
  refreshProviderModels(configuredProviderId: string): Promise<ModelPickerSnapshot>;
  setProviderVisibility(
    configuredProviderId: string,
    visible: boolean
  ): Promise<ModelPickerSnapshot>;
  setModelVisibility(modelConfigId: string, visible: boolean): Promise<ModelPickerSnapshot>;
  activateProviderModel(
    configuredProviderId: string,
    providerModelId: string
  ): Promise<ModelPickerSnapshot>;
}
