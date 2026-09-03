/**
 * @file src/infra/adapters/vector-store/qdrant/search/searchPoints.ts
 *
 * @brief Qdrant 向量检索封装（search）
 *
 * @description
 * 目标：把 “构造请求 + 解析返回” 从适配器类中拆出，提升内聚度。
 * 约束：不使用 any、不做不安全断言。
 */

import type { QdrantClient } from '@qdrant/js-client-rest';
import type { Logger } from 'src/shared/logger';
import type { SearchParams, SearchResult, SparseVector } from '../types';
import { hasNameAndVector, isNumberArray, isRecord, isSparseVector } from '../guards';

type QdrantSearchVector =
  | number[]
  | { name: string; vector: number[] }
  | { name: string; vector: SparseVector };

type QdrantSearchRequest = {
  vector: QdrantSearchVector;
  limit: number;
  with_payload: boolean;
  with_vector: boolean;
  score_threshold?: number;
  filter?: Record<string, unknown>;
};

function buildSearchVector(params: SearchParams): QdrantSearchVector {
  // 1) 允许直接传稠密向量数组（会用 vectorName 包装为命名向量）
  if (isNumberArray(params.vector)) {
    return { name: params.vectorName ?? 'default', vector: params.vector };
  }
  // 2) 允许传入形如 {name, vector} 的结构（dense 或 sparse）
  if (hasNameAndVector(params.vector)) {
    const name = params.vector.name;
    const v = params.vector.vector;
    if (isNumberArray(v)) return { name, vector: v };
    if (isSparseVector(v)) return { name, vector: v };
  }
  throw new Error(`[QdrantAdapter] searchPoints: 非法 vector 参数`);
}

function parseSearchResults(raw: unknown): SearchResult[] {
  // QdrantClient.search 在不同版本可能返回数组或对象，这里统一兼容解析
  const pointsRaw: unknown =
    Array.isArray(raw) ? raw : (isRecord(raw) ? raw['points'] : undefined);

  if (!Array.isArray(pointsRaw)) return [];

  return pointsRaw
    .map((point: unknown) => {
      if (!isRecord(point)) return undefined;
      const id = point['id'];
      const score = point['score'];
      const payload = point['payload'];

      if (typeof id !== 'string' && typeof id !== 'number') return undefined;
      if (typeof score !== 'number' || !Number.isFinite(score)) return undefined;

      return {
        id: typeof id === 'string' ? id : String(id),
        score,
        payload: isRecord(payload) ? payload : {}
      };
    })
    .filter((x): x is SearchResult => x !== undefined);
}

export async function searchPointsImpl(
  client: QdrantClient,
  collectionName: string,
  params: SearchParams,
  logger: Logger
): Promise<SearchResult[]> {
  logger.debug(`[QdrantAdapter] Searching in collection: ${collectionName}, limit: ${params.limit}`);

  const vectorPayload = buildSearchVector(params);
  const searchParams: QdrantSearchRequest = {
    vector: vectorPayload,
    limit: params.limit,
    with_payload: true,
    with_vector: false
  };

  if (params.scoreThreshold !== undefined) {
    searchParams.score_threshold = params.scoreThreshold;
  }
  if (params.filter) {
    searchParams.filter = params.filter;
  }

  const raw = await client.search(collectionName, searchParams);
  const results = parseSearchResults(raw);
  logger.debug(`[QdrantAdapter] Search completed, found ${results.length} results`);
  return results;
}


