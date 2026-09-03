import { ProviderCatalogSnapshotSchema } from '@app/schemas/provider-catalog';
import type { ProviderCatalogSnapshot } from '../../definitions/providerCatalog';

export function parseProviderCatalogSnapshot(input: unknown): ProviderCatalogSnapshot {
  const snapshot = ProviderCatalogSnapshotSchema.parse(input);
  const providerIds = new Set<string>();
  const connectionIds = new Set<string>();

  for (const provider of snapshot.providers) {
    if (providerIds.has(provider.id)) {
      throw new Error(`Provider Catalog 存在重复 Provider ID: ${provider.id}`);
    }
    providerIds.add(provider.id);

    for (const connection of provider.connections) {
      if (connectionIds.has(connection.id)) {
        throw new Error(`Provider Catalog 存在重复 connection ID: ${connection.id}`);
      }
      connectionIds.add(connection.id);

      const modelIds = new Set<string>();
      for (const model of connection.models) {
        if (modelIds.has(model.id)) {
          throw new Error(
            `Provider Catalog 存在重复模型 ID: ${provider.id}/${connection.id}/${model.id}`
          );
        }
        modelIds.add(model.id);
      }

      if (connection.model_discovery === 'bundled' && connection.models.length === 0) {
        throw new Error(`bundled connection 必须包含模型: ${connection.id}`);
      }
      if (connection.model_discovery !== 'bundled' && connection.models.length !== 0) {
        throw new Error(`动态发现 connection 不得捆绑静态模型: ${connection.id}`);
      }
    }
  }

  return snapshot;
}
