/**
 * @file src/features/knowledge-base/infrastructure/qdrant-repository/startupChunkCollectionMaintenance.ts
 *
 * @brief 启动后一次性 chunk collection 收缩维护
 */

import { Logger } from '@shared/logger';

import type { MetadataRepository } from '../metadataRepository';
import type { QdrantRepository } from '../qdrantRepository';
import type { ChunkCollectionRecreateResult } from './chunkCollectionRecreate';

export interface ChunkCollectionMaintenanceCapableRepository extends QdrantRepository {
  recreateChunkCollectionIfNeeded(collectionName: string): Promise<ChunkCollectionRecreateResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function hasChunkCollectionMaintenanceCapability(
  repository: unknown
): repository is ChunkCollectionMaintenanceCapableRepository {
  if (!isRecord(repository)) {
    return false;
  }

  return typeof repository['recreateChunkCollectionIfNeeded'] === 'function';
}

export type ChunkCollectionStartupMaintenanceStats = {
  scannedCollections: number;
  recreatedCollections: number;
  deletedEmptyCollections: number;
  skippedCollections: number;
  failedCollections: number;
};

function formatCollectionMaintenanceSummary(result: ChunkCollectionRecreateResult): string {
  if (result.action === 'recreated') {
    if (result.configuredTargetSegmentCountBefore !== result.targetSegmentCount) {
      return (
        `collection=${result.collectionName}, action=升段/降段重建, ` +
        `points=${result.pointsCountBefore}, segments=${result.segmentsCountBefore}, ` +
        `target=${result.configuredTargetSegmentCountBefore}->${result.targetSegmentCount}, restored=${result.restoredPointsCount}`
      );
    }

    return (
      `collection=${result.collectionName}, action=收缩重建, ` +
      `points=${result.pointsCountBefore}, segments=${result.segmentsCountBefore}, ` +
      `target=${result.targetSegmentCount}, restored=${result.restoredPointsCount}`
    );
  }

  if (result.action === 'deleted_empty') {
    return (
      `collection=${result.collectionName}, action=删除空集合, ` +
      `segments=${result.segmentsCountBefore}, target=${result.targetSegmentCount}`
    );
  }

  if (result.action === 'skipped_large_auto') {
    return (
      `collection=${result.collectionName}, action=跳过(自动策略), ` +
      `points=${result.pointsCountBefore}, segments=${result.segmentsCountBefore}, target=auto`
    );
  }

  if (result.action === 'skipped_already_compact') {
    return (
      `collection=${result.collectionName}, action=跳过(已达目标), ` +
      `points=${result.pointsCountBefore}, segments=${result.segmentsCountBefore}, target=${result.targetSegmentCount}`
    );
  }

  return `collection=${result.collectionName}, action=跳过(集合不存在)`;
}

export async function runChunkCollectionStartupMaintenanceOnce(
  metadataRepository: MetadataRepository,
  qdrantRepository: QdrantRepository
): Promise<ChunkCollectionStartupMaintenanceStats> {
  const logger = new Logger('ChunkCollectionStartupMaintenance');
  const stats: ChunkCollectionStartupMaintenanceStats = {
    scannedCollections: 0,
    recreatedCollections: 0,
    deletedEmptyCollections: 0,
    skippedCollections: 0,
    failedCollections: 0,
  };

  if (!hasChunkCollectionMaintenanceCapability(qdrantRepository)) {
    logger.info('当前 QdrantRepository 未实现 chunk collection 启动收缩能力，跳过');
    return stats;
  }

  const knowledgeBases = await metadataRepository.getAllKnowledgeBases();
  const collectionNames = Array.from(
    new Set(
      knowledgeBases
        .map((kb) => kb.id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim())
    )
  );

  for (const collectionName of collectionNames) {
    stats.scannedCollections += 1;
    try {
      const result = await qdrantRepository.recreateChunkCollectionIfNeeded(collectionName);
      if (result.action === 'recreated') {
        stats.recreatedCollections += 1;
      } else if (result.action === 'deleted_empty') {
        stats.deletedEmptyCollections += 1;
      } else {
        stats.skippedCollections += 1;
      }

      logger.info(`[ChunkCollectionStartupMaintenance] ${formatCollectionMaintenanceSummary(result)}`);
    } catch (error) {
      stats.failedCollections += 1;
      logger.error(
        `[ChunkCollectionStartupMaintenance] collection=${collectionName} 收缩失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return stats;
}
