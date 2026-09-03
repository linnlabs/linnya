import type {
  OllamaModelRegistrationCommand,
  OllamaModelRegistrationResponse,
} from '@app/schemas/ollama-onboarding';
import type {
  InferenceEndpointSelection,
  InferenceEndpointView,
  ModelConfig,
} from 'src/domains/model-catalog';
import type {
  BeginProviderModelRegistrationInput,
  ConfiguredProvider,
  PendingProviderModelRegistration,
} from 'src/domains/provider-configuration';
import type { ProviderConnectionCatalogEntry } from '@linnya/provider-catalog';

export interface OllamaOnboardingCatalogPort {
  getConnection(providerConnectionDefinitionId: string): ProviderConnectionCatalogEntry | undefined;
}

export interface OllamaOnboardingModelCatalogPort {
  getModel(modelConfigId: string): ModelConfig | undefined;
  getInferenceEndpoints(): InferenceEndpointView[];
  registerUserModel(model: ModelConfig, endpoint: InferenceEndpointSelection): Promise<void>;
}

export interface OllamaOnboardingConfigurationPort {
  getByProviderConnectionDefinitionId(
    providerConnectionDefinitionId: string
  ): ConfiguredProvider | undefined;
  beginModelRegistration(
    input: BeginProviderModelRegistrationInput
  ): Promise<PendingProviderModelRegistration>;
  completeModelRegistration(intentId: string): Promise<void>;
  cancelModelRegistration(intentId: string): Promise<void>;
}

export interface OllamaOnboardingIdFactory {
  create(): string;
}

export interface OllamaOnboardingUseCase {
  registerModel(command: OllamaModelRegistrationCommand): Promise<OllamaModelRegistrationResponse>;
}
