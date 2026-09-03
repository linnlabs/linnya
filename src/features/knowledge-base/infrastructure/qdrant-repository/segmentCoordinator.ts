/**
 * @file src/features/knowledge-base/infrastructure/qdrant-repository/segmentCoordinator.ts
 *
 * @brief 依据 points_count 协调 collection 的目标 segment 数
 */

import type { Logger } from '@shared/logger';
import type { QdrantRepository } from '../qdrantRepository';
import {
  buildSegmentOptimizerPatch,
  readConfiguredTargetSegmentCount,
  resolveTargetSegmentCountByPointsCount,
  type CollectionTargetSegmentCount,
} from './segmentPolicy';

type CollectionInfoSnapshot = {
  points_count: number;
  segments_count: number;
  config: Record<string, unknown>;
};

type SegmentCoordinatorDeps = {
  collectionName: string;
  logger: Logger;
  getCollectionInfo: () => Promise<CollectionInfoSnapshot>;
  updateCollection: (updateConfig: Record<string, unknown>) => Promise<void>;
};

export type CollectionSegmentReconcileResult = {
  collectionName: string;
  pointsCount: number;
  segmentsCount: number;
  previousTargetSegmentCount: CollectionTargetSegmentCount;
  nextTargetSegmentCount: CollectionTargetSegmentCount;
  updated: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 功能：执行一次 collection 目标段数校准。
 *
 * 说明：
 * - 这里只负责“决定是否 PATCH”，不保证 Qdrant 立刻把物理 segment 数收敛到目标；
 * - 真正的 merge / compact 由 Qdrant 后台 optimizer 渐进完成。
 */
export async function reconcileCollectionSegmentTarget(
  deps: SegmentCoordinatorDeps
): Promise<CollectionSegmentReconcileResult> {
  const info = await deps.getCollectionInfo();
  const pointsCount =
    Number.isFinite(info.points_count) && info.points_count >= 0 ? Math.trunc(info.points_count) : 0;
  const segmentsCount =
    Number.isFinite(info.segments_count) && info.segments_count >= 0 ? Math.trunc(info.segments_count) : 0;

  const previousTargetSegmentCount = readConfiguredTargetSegmentCount(info.config);
  const nextTargetSegmentCount = resolveTargetSegmentCountByPointsCount(pointsCount);

  if (previousTargetSegmentCount === nextTargetSegmentCount) {
    deps.logger.info(
      `[SegmentCoordinator] collection=${deps.collectionName} 目标段数无需调整: ` +
        `points=${pointsCount}, segments=${segmentsCount}, target=${nextTargetSegmentCount}`
    );
    return {
      collectionName: deps.collectionName,
      pointsCount,
      segmentsCount,
      previousTargetSegmentCount,
      nextTargetSegmentCount,
      updated: false,
    };
  }

  const patch = buildSegmentOptimizerPatch(nextTargetSegmentCount);
  deps.logger.info(
    `[SegmentCoordinator] 准备更新 collection 目标段数: ` +
      `collection=${deps.collectionName}, points=${pointsCount}, segments=${segmentsCount}, ` +
      `from=${previousTargetSegmentCount}, to=${nextTargetSegmentCount}, patch=${JSON.stringify(patch)}`
  );
  await deps.updateCollection(patch);

  return {
    collectionName: deps.collectionName,
    pointsCount,
    segmentsCount,
    previousTargetSegmentCount,
    nextTargetSegmentCount,
    updated: true,
  };
}

export interface SegmentTunableQdrantRepository extends QdrantRepository {
  reconcileCollectionSegmentTarget(collectionName: string): Promise<CollectionSegmentReconcileResult>;
}

/**
 * 功能：识别仓储是否支持动态段数校准。
 *
 * 说明：
 * - `StoringHandler` / `DocumentService` 依赖的是接口；
 * - 运行时实际注入的是 `QdrantRepositoryImpl`，这里用类型守卫安全识别扩展能力。
 */
export function hasSegmentTargetReconciler(
  repository: unknown
): repository is SegmentTunableQdrantRepository {
  if (!isRecord(repository)) {
    return false;
  }

  return typeof repository['reconcileCollectionSegmentTarget'] === 'function';
}

