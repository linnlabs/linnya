import type { ProviderDefinition } from '../../../definitions/providerCatalog';

export function findProviderDefinition(
  providers: readonly ProviderDefinition[],
  providerDefinitionId: string
): ProviderDefinition | undefined {
  return providers.find(provider => provider.id === providerDefinitionId);
}

export function searchProviderDefinitions(
  providers: readonly ProviderDefinition[],
  query: string
): readonly ProviderDefinition[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return providers;

  return providers.filter(provider => {
    if (provider.id.toLocaleLowerCase().includes(normalizedQuery)) return true;
    if (provider.display_name.toLocaleLowerCase().includes(normalizedQuery)) return true;
    return provider.connections.some(
      connection =>
        connection.id.toLocaleLowerCase().includes(normalizedQuery) ||
        connection.display_name.toLocaleLowerCase().includes(normalizedQuery) ||
        connection.models.some(
          model =>
            model.id.toLocaleLowerCase().includes(normalizedQuery) ||
            model.display_name.toLocaleLowerCase().includes(normalizedQuery)
        )
    );
  });
}
