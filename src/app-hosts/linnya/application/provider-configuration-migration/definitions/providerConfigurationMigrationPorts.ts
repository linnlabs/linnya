import type { InferenceEndpointView, ModelConfig } from 'src/domains/model-catalog';
import type { ConfiguredProvider } from 'src/domains/provider-configuration';
import type { ProviderDefinition } from '@linnya/provider-catalog';
import type { ProviderOnboardingRuntimeBinding } from 'src/app-hosts/linnya/adapters/inference';

export interface ProviderConfigurationMigrationCatalogPort {
  list(): readonly ProviderDefinition[];
}

export interface ProviderConfigurationMigrationBindingPort {
  get(providerConnectionDefinitionId: string): ProviderOnboardingRuntimeBinding | undefined;
}

export interface ProviderConfigurationMigrationModelCatalogPort {
  getModels(): ModelConfig[];
  getInferenceEndpoints(): InferenceEndpointView[];
}

export interface ProviderConfigurationMigrationRegistryPort {
  needsLegacyFormalProviderMigration(): boolean;
  completeLegacyFormalProviderMigration(
    migratedProviders: readonly ConfiguredProvider[]
  ): Promise<void>;
}

export interface ProviderConfigurationMigrationIdFactory {
  create(): string;
}

export interface ProviderConfigurationMigrationReport {
  readonly migrated_provider_count: number;
  readonly migrated_model_count: number;
  readonly skipped_provider_ids: readonly string[];
}
