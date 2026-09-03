import type {
  DirectProviderConnectionOnboardingCommand,
  DirectProviderConnectionOnboardingResponse,
  DirectProviderModelRegistrationCommand,
  DirectProviderModelRegistrationResponse,
} from '@app/schemas/provider-onboarding';
import type {
  InferenceEndpointSelection,
  InferenceEndpointView,
  ModelConfig,
} from 'src/domains/model-catalog';
import type {
  ProviderCatalogGeneration,
  ProviderConnectionCatalogEntry,
} from '@linnya/provider-catalog';
import type {
  BeginProviderModelRegistrationInput,
  ConfiguredProvider,
  PendingProviderModelRegistration,
} from 'src/domains/provider-configuration';
import type { ProviderOnboardingRuntimeBinding } from 'src/app-hosts/linnya/adapters/inference';
import type { ProviderAccountModelDefinition } from 'src/domains/provider-account';

export interface ProviderOnboardingCatalogPort {
  readonly generation: ProviderCatalogGeneration;
  getConnection(providerConnectionDefinitionId: string): ProviderConnectionCatalogEntry | undefined;
}

export interface ProviderOnboardingRuntimeBindingPort {
  readonly generation_id: string;
  readonly source_sha256: string;
  get(providerConnectionDefinitionId: string): ProviderOnboardingRuntimeBinding | undefined;
}

export interface ProviderOnboardingModelCatalogPort {
  getModel(modelConfigId: string): ModelConfig | undefined;
  getInferenceEndpoints(): InferenceEndpointView[];
  registerUserModel(model: ModelConfig, endpoint: InferenceEndpointSelection): Promise<void>;
  updateModel(model: ModelConfig): Promise<void>;
}

export interface ProviderOnboardingConfigurationPort {
  getByProviderConnectionDefinitionId(
    providerConnectionDefinitionId: string
  ): ConfiguredProvider | undefined;
  beginModelRegistration(
    input: BeginProviderModelRegistrationInput
  ): Promise<PendingProviderModelRegistration>;
  completeModelRegistration(intentId: string): Promise<void>;
  cancelModelRegistration(intentId: string): Promise<void>;
}

/** OAuth/device-flow 账号只向 onboarding 暴露稳定引用，不暴露 token。 */
export interface ProviderOnboardingAccountPort {
  findConnectedAccountId(providerConnectionDefinitionId: string): string | undefined;
}

/** 账号型 Provider 只通过该端口暴露授权后可见模型，不把 token 交给 onboarding。 */
export interface ProviderOnboardingAccountModelDiscoveryPort {
  discoverModels(
    providerConnectionDefinitionId: string,
    accountId: string
  ): Promise<readonly ProviderAccountModelDefinition[]>;
}

/** 账户目录下架模型复用统一 durable 删除用例，不在同步流程内复制跨文件删除顺序。 */
export interface ProviderOnboardingModelRemovalPort {
  remove(modelConfigId: string): Promise<void>;
}

export interface ProviderOnboardingIdFactory {
  create(): string;
}

export interface ProviderOnboardingUseCase {
  configureDirectProvider(
    command: DirectProviderConnectionOnboardingCommand
  ): Promise<DirectProviderConnectionOnboardingResponse>;
  registerDirectProviderModel(
    command: DirectProviderModelRegistrationCommand
  ): Promise<DirectProviderModelRegistrationResponse>;
  /** 用当前 bundled 目录原位刷新已经激活的模型，不新增或删除模型。 */
  refreshRegisteredBundledProviderModels(
    providerConnectionDefinitionId: string
  ): Promise<void>;
  synchronizeConnectedProviderModels(providerConnectionDefinitionId: string): Promise<void>;
}
