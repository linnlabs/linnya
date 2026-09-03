import type { InferenceAuthProfile, ModelConfig } from 'src/domains/model-catalog';

export interface ProviderAccountModelCatalogProjectionPort {
  replaceAccountModels(accountId: string, models: readonly ModelConfig[]): void;
  removeAccountModels(accountId: string): void;
}

export interface ProviderAccountModelRuntimeBinding {
  readonly endpoint_id: string;
  readonly default_base_url: string;
  readonly auth_profile: InferenceAuthProfile;
}

export interface ProviderAccountModelRuntimeBindingPort {
  get(providerConnectionDefinitionId: string): ProviderAccountModelRuntimeBinding | undefined;
}

/** 把账号产品拥有、但不在语言模型目录中的模型投影到当前进程 Model Catalog。 */
export interface ProviderAccountModelProjection {
  synchronize(providerConnectionDefinitionId: string, accountId: string): void;
  remove(accountId: string): void;
}

export interface ProviderAccountModelProjectionDependencies {
  readonly modelCatalog: ProviderAccountModelCatalogProjectionPort;
  readonly runtimeBindings: ProviderAccountModelRuntimeBindingPort;
}
