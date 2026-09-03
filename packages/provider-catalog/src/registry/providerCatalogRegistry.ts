import bundledCatalogAsset from '../generated/provider-catalog.generated.json';
import type { ProviderCatalog } from '../definitions/providerCatalog';
import { parseProviderCatalogSnapshot } from '../features/catalog-admission/parseProviderCatalogSnapshot';
import {
  findProviderDefinition,
  searchProviderDefinitions,
} from '../features/catalog-query/functions/queryProviderCatalog';

const snapshot = parseProviderCatalogSnapshot(bundledCatalogAsset);
const visibleProviders = Object.freeze(
  snapshot.providers.flatMap(provider => {
    const connections = provider.connections.filter(
      connection => connection.release_status !== 'hidden'
    );
    return connections.length === 0 ? [] : [{ ...provider, connections }];
  })
);
const connectionsById = new Map(
  visibleProviders.flatMap(provider =>
    provider.connections.map(connection => [connection.id, { provider, connection }] as const)
  )
);

export const providerCatalog: ProviderCatalog = Object.freeze({
  generation: snapshot.generation,
  list: () => visibleProviders,
  get: (providerDefinitionId: string) =>
    findProviderDefinition(visibleProviders, providerDefinitionId),
  getConnection: (providerConnectionDefinitionId: string) =>
    connectionsById.get(providerConnectionDefinitionId),
  search: (query: string) => searchProviderDefinitions(visibleProviders, query),
});
