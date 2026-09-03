/**
 * @file src/infra/adapters/vector-store/qdrant/scroll/scrollPointsPageWithVector.ts
 *
 * @brief Qdrant scroll 分页读取封装（包含向量）
 *
 * 说明：
 * - 该能力主要用于调试/诊断“点存在但向量检索返回 0”的根因；
 * - 默认业务逻辑不需要读取向量（会增加传输与 CPU 开销），因此单独提供实现，避免影响既有链路。
 */

import type { QdrantClient } from '@qdrant/js-client-rest';
import type { Logger } from 'src/shared/logger';
import type { QdrantScrollOffset } from '../types';
import { isQdrantScrollOffset, isRecord } from '../guards';

export async function scrollPointsPageWithVectorImpl(
  client: QdrantClient,
  collectionName: string,
  limit: number,
  offset: QdrantScrollOffset | undefined,
  logger: Logger
): Promise<{
  points: Array<{ id: string; payload: Record<string, unknown>; vector: unknown }>;
  nextOffset?: QdrantScrollOffset;
}> {
  logger.debug(
    `[QdrantAdapter] Scrolling collection page(with_vector): ${collectionName}, limit: ${limit}, offset=${
      offset === undefined ? 'none' : 'present'
    }`
  );

  const scrollParams: {
    limit: number;
    with_payload: true;
    with_vector: true;
    offset?: QdrantScrollOffset;
  } = {
    limit,
    with_payload: true,
    with_vector: true,
  };

  if (offset !== undefined) {
    scrollParams.offset = offset;
  }

  const raw = await client.scroll(collectionName, scrollParams);

  const pointsRaw: unknown = isRecord(raw) ? raw['points'] : undefined;
  const nextOffsetRaw: unknown = isRecord(raw) ? raw['next_page_offset'] : undefined;

  // Qdrant 在末尾可能返回 null，这里统一转换成 undefined，便于上层判断结束
  const nextOffset =
    isQdrantScrollOffset(nextOffsetRaw) && nextOffsetRaw !== null ? nextOffsetRaw : undefined;

  const points: Array<{ id: string; payload: Record<string, unknown>; vector: unknown }> = Array.isArray(pointsRaw)
    ? pointsRaw
        .map((p: unknown) => {
          if (!isRecord(p)) return undefined;
          const id = p['id'];
          const payload = p['payload'];
          const vector = p['vector'];

          if (typeof id !== 'string' && typeof id !== 'number') return undefined;
          const normalizedId = typeof id === 'string' ? id : String(id);
          const normalizedPayload: Record<string, unknown> = isRecord(payload) ? payload : {};

          // 向量可能是 number[] 或命名向量对象；这里保持 unknown（诊断场景只需要“存在性/结构”）
          return { id: normalizedId, payload: normalizedPayload, vector };
        })
        .filter((x): x is { id: string; payload: Record<string, unknown>; vector: unknown } => x !== undefined)
    : [];

  logger.debug(`[QdrantAdapter] Scroll page(with_vector) completed, found ${points.length} points`);
  return {
    points,
    nextOffset,
  };
}

