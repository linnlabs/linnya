/**
 * @file src/infra/adapters/vector-store/qdrant/collections/getCollection.ts
 *
 * @brief 获取集合信息（并把返回值收敛成项目需要的最小形态）
 */

import type { QdrantClient } from '@qdrant/js-client-rest';
import type { Logger } from 'src/shared/logger';
import type { QdrantCollectionInfo } from '../types';
import { isRecord } from '../guards';

export async function getCollectionImpl(
  client: QdrantClient,
  collectionName: string,
  logger: Logger
): Promise<QdrantCollectionInfo> {
  logger.debug(`[QdrantAdapter] Getting info for collection: ${collectionName}`);
  const raw = await client.getCollection(collectionName);

  if (!isRecord(raw)) {
    // 不做容错“猜测”，直接返回空对象（上层会自行兜底默认值）
    return {};
  }

  const configRaw = raw['config'];
  const info: QdrantCollectionInfo = {};

  const vectorsCount = raw['vectors_count'];
  if (typeof vectorsCount === 'number' && Number.isFinite(vectorsCount)) {
    info.vectors_count = vectorsCount;
  }
  const indexedVectorsCount = raw['indexed_vectors_count'];
  if (typeof indexedVectorsCount === 'number' && Number.isFinite(indexedVectorsCount)) {
    info.indexed_vectors_count = indexedVectorsCount;
  }
  const pointsCount = raw['points_count'];
  if (typeof pointsCount === 'number' && Number.isFinite(pointsCount)) {
    info.points_count = pointsCount;
  }
  const segmentsCount = raw['segments_count'];
  if (typeof segmentsCount === 'number' && Number.isFinite(segmentsCount)) {
    info.segments_count = segmentsCount;
  }
  if (isRecord(configRaw)) {
    info.config = configRaw;
  }

  logger.debug(`[QdrantAdapter] Get collection info success for: ${collectionName}`);
  return info;
}



