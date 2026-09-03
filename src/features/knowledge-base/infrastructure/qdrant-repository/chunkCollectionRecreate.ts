/**
 * @file src/features/knowledge-base/infrastructure/qdrant-repository/chunkCollectionRecreate.ts
 *
 * @brief chunk collection 启动收缩 / 重建编排
 */

import type { Logger } from '@shared/logger';

import type {
  QdrantPoint,
  SparseVector,
  VectorData,
} from '../qdrantRepository';
import { toPointPayload } from './payload';
import {
  readConfiguredTargetSegmentCount,
  resolveTargetSegmentCountByPointsCount,
  type CollectionTargetSegmentCount,
} from './segmentPolicy';

type CollectionInfoSnapshot = {
  points_count: number;
  segments_count: number;
  config: Record<string, unknown>;
};

type ScrolledPointWithVector = {
  id: string;
  payload: Record<string, unknown>;
  vector: unknown;
};

type ChunkCollectionRecreateDeps = {
  collectionName: string;
  logger: Logger;
  collectionExists: () => Promise<boolean>;
  getCollectionInfo: () => Promise<CollectionInfoSnapshot>;
  scrollPointsPageWithVector: (
    limit: number,
    offset?: unknown
  ) => Promise<{
    points: ScrolledPointWithVector[];
    nextOffset?: unknown;
  }>;
  deleteCollection: () => Promise<void>;
  createCollection: (params: {
    vectorSize: number;
    defaultSegmentNumber: CollectionTargetSegmentCount;
  }) => Promise<void>;
  upsertPoints: (points: QdrantPoint[]) => Promise<void>;
  countPoints: () => Promise<number>;
};

export type ChunkCollectionRecreateAction =
  | 'skipped_missing'
  | 'skipped_large_auto'
  | 'skipped_already_compact'
  | 'deleted_empty'
  | 'recreated';

export type ChunkCollectionRecreateResult = {
  collectionName: string;
  action: ChunkCollectionRecreateAction;
  pointsCountBefore: number;
  segmentsCountBefore: number;
  configuredTargetSegmentCountBefore: CollectionTargetSegmentCount;
  targetSegmentCount: CollectionTargetSegmentCount;
  restoredPointsCount: number;
};

const SCROLL_PAGE_SIZE = 1000;
const UPSERT_BATCH_SIZE = 200;
const SEGMENT_SHRINK_TOLERANCE = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function isSparseVector(value: unknown): value is SparseVector {
  if (!isRecord(value)) {
    return false;
  }

  const indices = value['indices'];
  const values = value['values'];
  if (!Array.isArray(indices) || !Array.isArray(values) || indices.length !== values.length) {
    return false;
  }

  return indices.every((item) => typeof item === 'number' && Number.isFinite(item)) &&
    values.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function isSegmentCountMateriallyAboveTarget(
  segmentsCount: number,
  targetSegmentCount: CollectionTargetSegmentCount
): boolean {
  if (targetSegmentCount <= 0) {
    return false;
  }

  // Qdrant 的 default_segment_number 是 optimizer 目标，不是物理段数硬约束。
  // 运行时证据表明，小库即使配置为 1 段，跨重启后也可能稳定回到 2 段；
  // 因此这里只在“明显高于目标值”时才触发破坏性重建，避免每次启动反复回灌。
  return segmentsCount > targetSegmentCount + SEGMENT_SHRINK_TOLERANCE;
}

function normalizeStoredVector(vector: unknown, collectionName: string, pointId: string): VectorData {
  if (isFiniteNumberArray(vector)) {
    return {
      default: vector,
    };
  }

  if (!isRecord(vector)) {
    throw new Error(
      `[ChunkCollectionRecreate] 向量结构非法: collection=${collectionName}, pointId=${pointId}`
    );
  }

  const denseVectorRaw = vector['default'];
  if (!isFiniteNumberArray(denseVectorRaw)) {
    throw new Error(
      `[ChunkCollectionRecreate] 缺少合法 default 向量: collection=${collectionName}, pointId=${pointId}`
    );
  }

  const normalized: VectorData = {
    default: denseVectorRaw,
  };

  const sparseVectorRaw = vector['bm25'];
  if (sparseVectorRaw !== undefined) {
    if (!isSparseVector(sparseVectorRaw)) {
      throw new Error(
        `[ChunkCollectionRecreate] bm25 向量结构非法: collection=${collectionName}, pointId=${pointId}`
      );
    }
    normalized.bm25 = sparseVectorRaw;
  }

  return normalized;
}

async function exportAllPointsWithVector(
  deps: ChunkCollectionRecreateDeps
): Promise<QdrantPoint[]> {
  const exportedPoints: QdrantPoint[] = [];
  let offset: unknown = undefined;

  while (true) {
    const page = await deps.scrollPointsPageWithVector(SCROLL_PAGE_SIZE, offset);
    for (const point of page.points) {
      exportedPoints.push({
        id: point.id,
        // 在仓储边界把 payload 从松散 Record 收敛为严格 PointPayload，避免把脏数据带入重建流程。
        payload: toPointPayload(point.payload),
        vector: normalizeStoredVector(point.vector, deps.collectionName, point.id),
      });
    }

    if (page.points.length === 0 || page.nextOffset === undefined) {
      break;
    }

    if (Object.is(page.nextOffset, offset)) {
      throw new Error(
        `[ChunkCollectionRecreate] scroll offset 未推进: collection=${deps.collectionName}`
      );
    }
    offset = page.nextOffset;
  }

  return exportedPoints;
}

async function restorePointsInBatches(
  deps: ChunkCollectionRecreateDeps,
  points: QdrantPoint[]
): Promise<void> {
  for (let index = 0; index < points.length; index += UPSERT_BATCH_SIZE) {
    const batch = points.slice(index, index + UPSERT_BATCH_SIZE);
    await deps.upsertPoints(batch);
  }
}

/**
 * 功能：在启动阶段根据 points/segments 状态判断并重建 chunk collection。
 */
export async function recreateChunkCollectionIfNeeded(
  deps: ChunkCollectionRecreateDeps
): Promise<ChunkCollectionRecreateResult> {
  const exists = await deps.collectionExists();
  if (!exists) {
    return {
      collectionName: deps.collectionName,
      action: 'skipped_missing',
      pointsCountBefore: 0,
      segmentsCountBefore: 0,
      configuredTargetSegmentCountBefore: resolveTargetSegmentCountByPointsCount(0),
      targetSegmentCount: resolveTargetSegmentCountByPointsCount(0),
      restoredPointsCount: 0,
    };
  }

  const info = await deps.getCollectionInfo();
  const pointsCount =
    Number.isFinite(info.points_count) && info.points_count >= 0 ? Math.trunc(info.points_count) : 0;
  const segmentsCount =
    Number.isFinite(info.segments_count) && info.segments_count >= 0 ? Math.trunc(info.segments_count) : 0;
  const configuredTargetSegmentCount = readConfiguredTargetSegmentCount(info.config);
  const targetSegmentCount = resolveTargetSegmentCountByPointsCount(pointsCount);

  if (pointsCount === 0) {
    deps.logger.info(
      `[ChunkCollectionRecreate] collection 为空，直接删除: collection=${deps.collectionName}, segments=${segmentsCount}`
    );
    await deps.deleteCollection();
    return {
      collectionName: deps.collectionName,
      action: 'deleted_empty',
      pointsCountBefore: pointsCount,
      segmentsCountBefore: segmentsCount,
      configuredTargetSegmentCountBefore: configuredTargetSegmentCount,
      targetSegmentCount,
      restoredPointsCount: 0,
    };
  }

  if (configuredTargetSegmentCount === targetSegmentCount && targetSegmentCount === 0) {
    return {
      collectionName: deps.collectionName,
      action: 'skipped_large_auto',
      pointsCountBefore: pointsCount,
      segmentsCountBefore: segmentsCount,
      configuredTargetSegmentCountBefore: configuredTargetSegmentCount,
      targetSegmentCount,
      restoredPointsCount: 0,
    };
  }

  const needsTargetTransition = configuredTargetSegmentCount !== targetSegmentCount;
  const needsSegmentShrink = isSegmentCountMateriallyAboveTarget(segmentsCount, targetSegmentCount);
  if (!needsTargetTransition && !needsSegmentShrink) {
    return {
      collectionName: deps.collectionName,
      action: 'skipped_already_compact',
      pointsCountBefore: pointsCount,
      segmentsCountBefore: segmentsCount,
      configuredTargetSegmentCountBefore: configuredTargetSegmentCount,
      targetSegmentCount,
      restoredPointsCount: pointsCount,
    };
  }

  const rebuildReason =
    needsTargetTransition && needsSegmentShrink
      ? 'target-transition+shrink'
      : needsTargetTransition
        ? 'target-transition'
        : 'shrink';

  deps.logger.info(
    `[ChunkCollectionRecreate] 准备重建 collection: ` +
      `collection=${deps.collectionName}, reason=${rebuildReason}, ` +
      `points=${pointsCount}, segments=${segmentsCount}, ` +
      `configuredTarget=${configuredTargetSegmentCount}, target=${targetSegmentCount}`
  );

  const exportedPoints = await exportAllPointsWithVector(deps);
  if (exportedPoints.length !== pointsCount) {
    throw new Error(
      `[ChunkCollectionRecreate] 导出点数不一致: collection=${deps.collectionName}, expected=${pointsCount}, actual=${exportedPoints.length}`
    );
  }

  const vectorSize = exportedPoints[0]?.vector.default.length;
  if (typeof vectorSize !== 'number' || !Number.isFinite(vectorSize) || vectorSize <= 0) {
    throw new Error(
      `[ChunkCollectionRecreate] 无法推断向量维度: collection=${deps.collectionName}`
    );
  }

  await deps.deleteCollection();
  await deps.createCollection({
    vectorSize,
    defaultSegmentNumber: targetSegmentCount,
  });
  await restorePointsInBatches(deps, exportedPoints);

  const restoredPointsCount = await deps.countPoints();
  if (restoredPointsCount !== pointsCount) {
    throw new Error(
      `[ChunkCollectionRecreate] 回灌点数不一致: collection=${deps.collectionName}, expected=${pointsCount}, actual=${restoredPointsCount}`
    );
  }

  return {
    collectionName: deps.collectionName,
    action: 'recreated',
    pointsCountBefore: pointsCount,
    segmentsCountBefore: segmentsCount,
    configuredTargetSegmentCountBefore: configuredTargetSegmentCount,
    targetSegmentCount,
    restoredPointsCount,
  };
}
