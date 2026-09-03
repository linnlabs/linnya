import type { ProviderCatalogSnapshot } from '../../definitions/providerCatalog';

function modelKeys(snapshot: ProviderCatalogSnapshot): Set<string> {
  return new Set(
    snapshot.providers.flatMap(provider =>
      provider.connections.flatMap(connection =>
        connection.models.map(model => `${provider.id}/${connection.id}/${model.id}`)
      )
    )
  );
}

function difference(left: ReadonlySet<string>, right: ReadonlySet<string>): readonly string[] {
  return [...left].filter(value => !right.has(value)).sort();
}

export function describeProviderCatalogDiff(
  previous: ProviderCatalogSnapshot | undefined,
  next: ProviderCatalogSnapshot,
  runtimeBindingChanged: boolean
): string {
  if (!previous) {
    return [
      'Provider Catalog 首次生成',
      `Provider: ${next.providers.length}`,
      `Bundled models: ${modelKeys(next).size}`,
      `Runtime binding changed: ${runtimeBindingChanged}`,
    ].join('\n');
  }

  const previousModels = modelKeys(previous);
  const nextModels = modelKeys(next);
  const addedModels = difference(nextModels, previousModels);
  const removedModels = difference(previousModels, nextModels);
  const changedLimits = next.providers.flatMap(provider => {
    const previousProvider = previous.providers.find(candidate => candidate.id === provider.id);
    if (!previousProvider) return [];
    return provider.connections.flatMap(connection => {
      const previousConnection = previousProvider.connections.find(
        candidate => candidate.id === connection.id
      );
      if (!previousConnection) return [];
      return connection.models.flatMap(model => {
        const previousModel = previousConnection.models.find(
          candidate => candidate.id === model.id
        );
        if (!previousModel) return [];
        const changed =
          previousModel.context_window_tokens !== model.context_window_tokens ||
          previousModel.max_input_tokens !== model.max_input_tokens ||
          previousModel.max_output_tokens !== model.max_output_tokens;
        return changed ? [`${provider.id}/${connection.id}/${model.id}`] : [];
      });
    });
  });

  const renderGroup = (label: string, values: readonly string[]) =>
    values.length === 0 ? `${label}: 0` : `${label}: ${values.length}\n  ${values.join('\n  ')}`;

  return [
    `Generation: ${previous.generation.id} -> ${next.generation.id}`,
    renderGroup('Added models', addedModels),
    renderGroup('Removed models', removedModels),
    renderGroup('Changed model limits', changedLimits),
    `Runtime binding/source observation changed: ${runtimeBindingChanged}`,
  ].join('\n');
}
