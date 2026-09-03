import type {
  ProviderCatalogGeneration,
  ProviderConnectionDefinition,
  ProviderDefinition,
} from '@app/schemas/provider-catalog';

export type {
  ProviderCatalogGeneration,
  ProviderCatalogSnapshot,
  ProviderConnectionDefinition,
  ProviderConnectionKind,
  ProviderConnectionReleaseStatus,
  ProviderDefinition,
  ProviderKind,
  ProviderModelCapabilities,
  ProviderModelDefinition,
  ProviderModelDiscoveryKind,
  ProviderModelReleaseStatus,
  ProviderReleaseStatus,
  ProviderSetupField,
} from '@app/schemas/provider-catalog';

export interface ProviderConnectionCatalogEntry {
  readonly provider: ProviderDefinition;
  readonly connection: ProviderConnectionDefinition;
}

export interface ProviderCatalog {
  readonly generation: ProviderCatalogGeneration;
  list(): readonly ProviderDefinition[];
  get(providerDefinitionId: string): ProviderDefinition | undefined;
  getConnection(providerConnectionDefinitionId: string): ProviderConnectionCatalogEntry | undefined;
  search(query: string): readonly ProviderDefinition[];
}
