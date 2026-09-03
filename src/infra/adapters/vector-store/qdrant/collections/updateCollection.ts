/**
 * @file src/infra/adapters/vector-store/qdrant/collections/updateCollection.ts
 *
 * @brief 更新集合配置（HTTP PATCH）
 */

import type { Logger } from 'src/shared/logger';
import type { QdrantConfig } from '../types';

export async function updateCollectionImpl(
  qdrantConfig: QdrantConfig,
  collectionName: string,
  updateConfig: Record<string, unknown>,
  logger: Logger
): Promise<void> {
  logger.info(`[QdrantAdapter] Updating collection: ${collectionName} with config: ${JSON.stringify(updateConfig)}`);

  const response = await fetch(`${qdrantConfig.url}/collections/${collectionName}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(qdrantConfig.apiKey ? { Authorization: `Bearer ${qdrantConfig.apiKey}` } : {})
    },
    body: JSON.stringify(updateConfig)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`updateCollection HTTP ${response.status}: ${errorText}`);
  }

  logger.info(`[QdrantAdapter] Collection updated: ${collectionName}`);
}


