/**
 * @file src/infra/adapters/vector-store/qdrant/points/retrievePoints.ts
 *
 * 按 point id 精确读取点的轻量封装。
 */

import type { QdrantClient } from '@qdrant/js-client-rest';
import type { Logger } from 'src/shared/logger';
import { isRecord } from '../guards';

export async function retrievePointsImpl(
  client: QdrantClient,
  collectionName: string,
  pointIds: string[],
  logger: Logger
): Promise<Array<{ id: string; payload: Record<string, unknown> }>> {
  if (pointIds.length === 0) return [];

  logger.debug(`[QdrantAdapter] Retrieving ${pointIds.length} points from collection: ${collectionName}`);
  const raw = await client.retrieve(collectionName, {
    ids: pointIds,
    with_payload: true,
    with_vector: false,
  });

  const pointsRaw: unknown[] = Array.isArray(raw) ? raw : [];
  return pointsRaw
    .map((point: unknown) => {
      if (!isRecord(point)) return undefined;
      const id = point['id'];
      const payload = point['payload'];
      if (typeof id !== 'string' && typeof id !== 'number') return undefined;
      return {
        id: typeof id === 'string' ? id : String(id),
        payload: isRecord(payload) ? payload : {},
      };
    })
    .filter((point): point is { id: string; payload: Record<string, unknown> } => point !== undefined);
}
