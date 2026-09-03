/**
 * @file src/infra/adapters/vector-store/qdrant/delete/deletePoints.ts
 *
 * @brief 删除点（按 ids 或按 filter）
 */

import type { QdrantClient } from '@qdrant/js-client-rest';
import type { Logger } from 'src/shared/logger';
import type { DeleteParams } from '../types';

export async function deletePointsImpl(
  client: QdrantClient,
  collectionName: string,
  params: DeleteParams,
  logger: Logger
): Promise<void> {
  logger.debug(`[QdrantAdapter] Deleting points from collection: ${collectionName}`);

  // 注意：
  // - `@qdrant/js-client-rest` 的 delete 入参要求满足：
  //   `{ wait?, ordering? } & ( { points: [...] } | { filter: Filter } )`
  // - 这里通过 `DeleteParams` 的联合类型保证“points / filter 二选一”，从源头消除类型不确定性
  if (params.points !== undefined) {
    await client.delete(collectionName, { wait: true, points: params.points });
    logger.debug(`[QdrantAdapter] Delete completed for collection: ${collectionName}`);
    return;
  }

  await client.delete(collectionName, { wait: true, filter: params.filter });
  logger.debug(`[QdrantAdapter] Delete completed for collection: ${collectionName}`);
}



