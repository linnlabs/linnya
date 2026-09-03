/**
 * @file src/infra/adapters/vector-store/qdrant/scroll/scrollPointsPage.ts
 *
 * @brief Qdrant scroll 分页读取封装
 */

import type { QdrantClient } from '@qdrant/js-client-rest';
import type { Logger } from 'src/shared/logger';
import type { QdrantScrollOffset } from '../types';
import { isQdrantScrollOffset, isRecord } from '../guards';

export async function scrollPointsPageImpl(
  client: QdrantClient,
  collectionName: string,
  limit: number,
  offset: QdrantScrollOffset | undefined,
  logger: Logger
): Promise<{
  points: Array<{ id: string; payload: Record<string, unknown> }>;
  nextOffset?: QdrantScrollOffset;
}> {
  logger.debug(
    `[QdrantAdapter] Scrolling collection page: ${collectionName}, limit: ${limit}, offset=${offset === undefined ? 'none' : 'present'}`
  );

  const scrollParams: {
    limit: number;
    with_payload: true;
    with_vector: false;
    offset?: QdrantScrollOffset;
  } = {
    limit,
    with_payload: true,
    with_vector: false
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

  const points: Array<{ id: string; payload: Record<string, unknown> }> = Array.isArray(pointsRaw)
    ? pointsRaw
        .map((p: unknown) => {
          if (!isRecord(p)) return undefined;
          const id = p['id'];
          const payload = p['payload'];
          if (typeof id !== 'string' && typeof id !== 'number') return undefined;
          const normalizedId = typeof id === 'string' ? id : String(id);
          const normalizedPayload: Record<string, unknown> = isRecord(payload) ? payload : {};
          return { id: normalizedId, payload: normalizedPayload };
        })
        .filter((x): x is { id: string; payload: Record<string, unknown> } => x !== undefined)
    : [];

  logger.debug(`[QdrantAdapter] Scroll page completed, found ${points.length} points`);
  return {
    points,
    nextOffset
  };
}


