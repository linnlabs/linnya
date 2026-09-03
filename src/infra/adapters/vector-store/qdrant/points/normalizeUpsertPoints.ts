/**
 * @file src/infra/adapters/vector-store/qdrant/points/normalizeUpsertPoints.ts
 *
 * @brief upsertPoints 输入归一化（把 VectorPoint 转成 Qdrant SDK 需要的结构）
 *
 * @description
 * 约束：
 * - 不使用 any
 * - 不做不安全断言
 * - 发现输入不符合约定时，直接抛出明确错误（根因暴露）
 */

import type { Logger } from 'src/shared/logger';
import type { SparseVector, UpsertResult, UpsertVector, VectorPoint } from '../types';
import { isNumberArray, isRecord, isSparseVector } from '../guards';

type QdrantNamedVector = Record<string, number[] | SparseVector>;

function toNamedVector(pointId: string, vector: UpsertVector, logger: Logger): QdrantNamedVector {
  // 旧格式：单稠密向量数组，统一归一化为命名向量 default
  if (Array.isArray(vector)) {
    if (!isNumberArray(vector)) {
      throw new Error(`[QdrantAdapter] Point ${pointId} 的稠密向量包含非有限数字`);
    }
    logger.debug(`[QdrantAdapter] Point ${pointId}: normalize single vector -> default`);
    return { default: vector };
  }

  // 新格式：命名向量（default + 可选 bm25）
  if (!isRecord(vector) || !isNumberArray(vector['default'])) {
    throw new Error(`[QdrantAdapter] Point ${pointId} 缺少 default 稠密向量`);
  }

  const result: QdrantNamedVector = { default: vector['default'] };

  const bm25 = vector['bm25'];
  if (bm25 !== undefined) {
    if (!isSparseVector(bm25)) {
      throw new Error(`[QdrantAdapter] Point ${pointId} 的 bm25 稀疏向量结构非法`);
    }
    result.bm25 = bm25;
  }

  return result;
}

export function normalizeUpsertPoints(points: VectorPoint[], logger: Logger): Array<{
  id: string;
  vector: QdrantNamedVector;
  payload: Record<string, unknown>;
}> {
  return points.map((point) => {
    const vector = toNamedVector(point.id, point.vector, logger);
    return {
      id: point.id,
      vector,
      payload: point.payload
    };
  });
}

export function parseUpsertResult(raw: unknown): UpsertResult {
  if (!isRecord(raw)) {
    throw new Error(`[QdrantAdapter] upsert 返回值不是对象，无法解析`);
  }
  const operationId = raw['operation_id'];
  const status = raw['status'];
  if (typeof operationId !== 'number' || !Number.isFinite(operationId)) {
    throw new Error(`[QdrantAdapter] upsert 返回值缺少 operation_id`);
  }
  if (typeof status !== 'string' || status.length === 0) {
    throw new Error(`[QdrantAdapter] upsert 返回值缺少 status`);
  }
  return { operation_id: operationId, status };
}


