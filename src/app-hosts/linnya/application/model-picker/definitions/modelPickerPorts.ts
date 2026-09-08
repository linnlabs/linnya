import type { ModelPickerSnapshot } from '@app/schemas/model-picker';
import type {
  DirectProviderModelRegistrationCommand,
  DirectProviderModelRegistrationResponse,
} from '@app/schemas/provider-onboarding';
import type {
  EndpointCredentialStatus,
  InferenceEndpointView,
  ModelConfig,
} from 'src/domains/model-catalog';
import type { ProviderCatalog, ProviderDefinition } from '@linnya/provider-catalog';
import type { ConfiguredProvider } from 'src/domains/provider-configuration';
import type { ModelPickerPreferencesSnapshot } from 'src/domains/model-picker-preferences';
import type {
  ProviderAccount,
  ProviderAccountCredentialStatus,
} from 'src/domains/provider-account';

export interface ModelPickerModelCatalogPort {
  getModels(): ModelConfig[];
  getModel(modelConfigId: string): ModelConfig | undefined;
  getInferenceEndpoints(): InferenceEndpointView[];
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

export interface ModelPickerProviderModelActivationPort {
  registerDirectProviderModel(
    command: DirectProviderModelRegistrationCommand
  ): Promise<DirectProviderModelRegistrationResponse>;
}

export interface ComposeSelectableModelMenuInput {
  readonly provider_definitions: readonly ProviderDefinition[];
  readonly configured_providers: readonly ConfiguredProvider[];
  readonly models: readonly ModelConfig[];
  readonly inference_endpoints: readonly InferenceEndpointView[];
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
