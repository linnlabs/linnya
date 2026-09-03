/**
 * @file src/knowledge-base/infrastructure/QdrantRepositoryImpl.ts
 *
 * @brief Qdrant向量数据库仓储实现
 *
 * @description
 * 该文件实现了QdrantRepository接口，提供与Qdrant向量数据库交互的具体实现。
 * 支持混合搜索、多向量存储等高级功能。
 */

import { QdrantRepository, QdrantPoint, RetrievedPoint, SearchFilterOptions, SearchResult } from './qdrantRepository';
import { QdrantAdapter } from '@infra/adapters/vector-store/qdrant';
import { Logger } from '@shared/logger';
import { rrfFusion } from '../utils/ranking';
import type { QdrantScrollOffset } from '@infra/adapters/vector-store/qdrant';
import type { Distance, MultiVectorCollectionConfig } from '@infra/adapters/vector-store/qdrant';

import { toPointPayload } from './qdrant-repository/payload';
import { buildQdrantFilter } from './qdrant-repository/filters';
import { normalizeDistanceMetric } from './qdrant-repository/distance';
import { isCollectionAlreadyExistsError } from './qdrant-repository/errors';
import { assertCollectionSupportsSparseVectors } from './qdrant-repository/collectionSchema';
import {
  runWithCollectionAccess,
  type CollectionAccessMode,
} from './qdrant-repository/collectionAccess';
import {
  recreateChunkCollectionIfNeeded as recreateChunkCollectionIfNeededImpl,
  type ChunkCollectionRecreateResult,
} from './qdrant-repository/chunkCollectionRecreate';
import {
  reconcileCollectionSegmentTarget as reconcileCollectionSegmentTargetImpl,
  type CollectionSegmentReconcileResult,
} from './qdrant-repository/segmentCoordinator';
import { resolveTargetSegmentCountByPointsCount } from './qdrant-repository/segmentPolicy';
import { textToSparseVector } from './qdrant-repository/sparseVector';

export class QdrantRepositoryImpl implements QdrantRepository {
  private readonly qdrantAdapter: QdrantAdapter;
  private readonly logger: Logger;

  constructor(qdrantAdapter: QdrantAdapter) {
    this.qdrantAdapter = qdrantAdapter;
    this.logger = new Logger('QdrantRepository');
  }

  /**
   * 🔥 新增：获取所有向量点的方法 - 用于数据一致性检查
   * **功能 (What):** 获取集合中所有向量点的ID和载荷信息
   * **输入 (Input):** 集合名称，可选的限制数量
   * **输出 (Output):** 包含ID和载荷的点数组
   * **副作用 (Side-effects):** 查询Qdrant数据库
   */
  async getAllPoints(
    collectionName: string,
    limit: number = 10000
  ): Promise<Array<{ id: string; payload: Record<string, unknown> }>> {
    return await this.qdrantAdapter.scrollPoints(collectionName, limit);
  }

  async scrollPointsPage(
    collectionName: string,
    limit: number,
    offset?: unknown
  ): Promise<{
    points: Array<{ id: string; payload: Record<string, unknown> }>;
    nextOffset?: unknown;
  }> {
    const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
    const isScrollOffset = (v: unknown): v is QdrantScrollOffset => {
      if (v === null) return true;
      if (typeof v === 'string') return true;
      if (typeof v === 'number' && Number.isFinite(v)) return true;
      if (isRecord(v)) return true;
      return false;
    };

    const normalizedOffset: QdrantScrollOffset | undefined =
      offset === undefined ? undefined : (isScrollOffset(offset) ? offset : undefined);

    return await this.qdrantAdapter.scrollPointsPage(collectionName, limit, normalizedOffset);
  }

  async getOrCreateCollection(
    collectionName: string, 
    vectorSize: number, 
    distanceMetric: string = 'Cosine',
    supportSparse: boolean = false,
    options?: {
      defaultSegmentNumber?: number;
    }
  ): Promise<void> {
    await this.runWithCollectionAccess(collectionName, 'shared', async () => {
      const collectionExists = await this.collectionExists(collectionName);
      const defaultSegmentNumber =
        typeof options?.defaultSegmentNumber === 'number' &&
        Number.isFinite(options.defaultSegmentNumber) &&
        options.defaultSegmentNumber >= 0
          ? Math.trunc(options.defaultSegmentNumber)
          : undefined;
      
      if (!collectionExists) {
        if (supportSparse) {
          // 创建多向量集合（default 稠密向量 + bm25 稀疏向量）
          const vectorConfig: MultiVectorCollectionConfig = {
            default: {
              size: vectorSize,
              distance: normalizeDistanceMetric(distanceMetric)
            },
            bm25: {}
          };
        
          this.logger.info(`创建多向量集合: ${collectionName} (稠密向量: ${vectorSize}维 + BM25稀疏向量)`);
          try {
            await this.qdrantAdapter.createCollection(collectionName, vectorConfig, 'Cosine', {
              optimizerConfig: {
                defaultSegmentNumber,
              },
            });
          } catch (err) {
            if (isCollectionAlreadyExistsError(err)) {
              this.logger.warn(`集合 ${collectionName} 并发创建发生冲突(409)，视为已存在，继续`);
            } else {
              throw err;
            }
          }
        } else {
          // 单向量模式（统一使用命名向量 default；由 QdrantAdapter.createCollection 保证 schema 一致）
          this.logger.info(`创建单向量集合: ${collectionName} (${vectorSize}维)`);
          try {
            const normalizedDistance: Distance = normalizeDistanceMetric(distanceMetric);
            await this.qdrantAdapter.createCollection(collectionName, vectorSize, normalizedDistance, {
              optimizerConfig: {
                defaultSegmentNumber,
              },
            });
          } catch (err) {
            if (isCollectionAlreadyExistsError(err)) {
              this.logger.warn(`集合 ${collectionName} 并发创建发生冲突(409)，视为已存在，继续`);
            } else {
              throw err;
            }
          }
        }
      } else if (supportSparse) {
        this.logger.info(`检查现有集合 ${collectionName} 的稀疏向量支持...`);
        
        try {
          const collectionInfo = await this.getCollectionInfo(collectionName);
          const configStr = JSON.stringify(collectionInfo.config, null, 2);
          this.logger.info(`现有集合配置: ${configStr}`);
          assertCollectionSupportsSparseVectors(collectionName, collectionInfo.config, this.logger);
        } catch (error) {
          this.logger.error(`检查集合配置失败:`, error);
          if (error instanceof Error) {
            throw error;
          }
          throw new Error(`检查集合 ${collectionName} 配置失败：${String(error)}`);
        }
      }
    });
  }



  async deleteCollection(collectionName: string): Promise<void> {
    await this.qdrantAdapter.deleteCollection(collectionName);
  }

  async collectionExists(collectionName: string): Promise<boolean> {
    return await this.qdrantAdapter.collectionExists(collectionName);
  }

  async addPoints(collectionName: string, points: QdrantPoint[]): Promise<void> {
    await this.runWithCollectionAccess(collectionName, 'shared', async () => {
      const vectorPoints = points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload
      }));

      const hasMultiVector = points.some((p) => p.vector.bm25 !== undefined);
      this.logger.info(`准备存储 ${vectorPoints.length} 个点 (${hasMultiVector ? '多向量' : '单向量'}格式)`);
      
      await this.qdrantAdapter.upsertPoints(collectionName, vectorPoints);
    });
  }

  async semanticSearch(
    collectionName: string,
    queryVector: number[],
    topK: number = 10,
    filter?: SearchFilterOptions,
    scoreThreshold?: number
  ): Promise<RetrievedPoint[]> {
    return await this.runWithCollectionAccess(collectionName, 'shared', async () => {
      try {
        this.logger.info(`开始语义搜索 - 集合: ${collectionName}, topK: ${topK}, 向量维度: ${queryVector.length}`);
        
        // 转换过滤器
        const qdrantFilter = buildQdrantFilter(filter);
        this.logger.info(`搜索过滤器: ${JSON.stringify(qdrantFilter)}`);
        
        // 调用适配器的 searchPoints 方法执行向量搜索
        const searchResults = await this.qdrantAdapter.searchPoints(collectionName, {
          vector: queryVector,
          vectorName: 'default',
          limit: topK,
          filter: qdrantFilter,
          scoreThreshold
        });
        
        this.logger.info(`Qdrant 原始搜索结果数量: ${searchResults.length}`);
        
        // 转换结果格式
        const retrievedPoints: RetrievedPoint[] = searchResults.map((result) => ({
          id: result.id,
          score: result.score,
          payload: toPointPayload(result.payload),
          match_type: 'semantic'
        }));
        
        this.logger.info(`语义搜索完成，找到 ${retrievedPoints.length} 个结果`);
        return retrievedPoints;
      } catch (error) {
        this.logger.error(`语义搜索失败: ${error}`);
        return [];
      }
    });
  }

  async keywordSearch(
    collectionName: string,
    queryText: string,
    topK: number = 10,
    filter?: SearchFilterOptions
  ): Promise<RetrievedPoint[]> {
    return await this.runWithCollectionAccess(collectionName, 'shared', async () => {
      try {
        const sparseVector = await textToSparseVector(queryText, this.logger);
        this.logger.info(`生成稀疏向量成功，维度: ${sparseVector.indices.length}`);

        const qdrantFilter = buildQdrantFilter(filter);

        const searchResults = await this.qdrantAdapter.searchPoints(collectionName, {
          vector: { name: 'bm25', vector: sparseVector },
          limit: topK,
          filter: qdrantFilter
        });

        const retrievedPoints: RetrievedPoint[] = searchResults.map((result) => ({
          id: result.id,
          score: result.score,
          payload: toPointPayload(result.payload),
          match_type: 'keyword'
        }));

        return retrievedPoints;
      } catch (error) {
        this.logger.error(`关键词搜索失败: ${String(error)}`);
        return [];
      }
    });
  }

  async hybridSearch(
    collectionName: string,
    queryText: string,
    queryVector: number[],
    topK: number = 10,
    filter?: SearchFilterOptions,
    rrfK: number = 60
  ): Promise<SearchResult> {
    // 🔥 使用核心ranking算法：RRF混合搜索
    const [semanticResults, keywordResults] = await Promise.all([
      this.semanticSearch(collectionName, queryVector, topK * 2, filter),
      this.keywordSearch(collectionName, queryText, topK * 2, filter)
    ]);
    
    // 🔥 使用核心RRF融合算法
    const fusedResults = rrfFusion(semanticResults, keywordResults, rrfK);
    
    // 转换回RetrievedPoint格式并限制数量
    const combinedResults: RetrievedPoint[] = fusedResults
      .slice(0, topK)
      .map(result => ({
        id: result.id,
        score: result.score,
        payload: result.payload,
        match_type: result.match_type || 'hybrid'
      }));
    
    return {
      semanticResults,
      keywordResults,
      combinedResults,
      stats: {
        total_semantic: semanticResults.length,
        total_keyword: keywordResults.length,
        total_combined: combinedResults.length,
        search_time_ms: 0 // TODO: 实现计时
      }
    };
  }

  async deletePointsByDocId(collectionName: string, docId: string): Promise<void> {
    await this.runWithCollectionAccess(collectionName, 'shared', async () => {
      // 🔥 修复：使用正确的方法名和类型转换
      await this.qdrantAdapter.deleteByDocId(collectionName, docId);
    });
  }

  async deletePointsByFilter(collectionName: string, filter: SearchFilterOptions): Promise<void> {
    await this.runWithCollectionAccess(collectionName, 'shared', async () => {
      const qdrantFilter = buildQdrantFilter(filter);
      if (!qdrantFilter) {
        // 明确无条件删除风险极高：这里要求调用方给出过滤条件
        throw new Error('deletePointsByFilter 需要至少一个过滤条件，拒绝执行无条件删除');
      }
      await this.qdrantAdapter.deletePoints(collectionName, { filter: qdrantFilter });
    });
  }

  async deletePointsByIds(collectionName: string, pointIds: string[]): Promise<void> {
    if (pointIds.length === 0) return;
    await this.runWithCollectionAccess(collectionName, 'shared', async () => {
      await this.qdrantAdapter.deletePoints(collectionName, { points: pointIds });
    });
  }

  async countPointsByDocId(collectionName: string, docId: string): Promise<number> {
    return await this.runWithCollectionAccess(collectionName, 'shared', async () => {
      return await this.qdrantAdapter.countPoints(collectionName, {
        exact: true,
        filter: {
          must: [
            {
              key: 'doc_id',
              match: { value: docId }
            }
          ]
        }
      });
    });
  }

  async countPointsByIds(collectionName: string, pointIds: string[]): Promise<number> {
    if (pointIds.length === 0) return 0;
    return await this.runWithCollectionAccess(collectionName, 'shared', async () => {
      const expectedIds = new Set(pointIds);
      const points = await this.qdrantAdapter.retrievePoints(collectionName, Array.from(expectedIds));
      return points.filter((point) => expectedIds.has(point.id)).length;
    });
  }

  async getCollectionInfo(collectionName: string): Promise<{
    vectors_count: number;
    indexed_vectors_count: number;
    points_count: number;
    segments_count: number;
    config: Record<string, unknown>;
  }> {
    /**
     * 根因修复：
     * - 旧实现遇到任何错误都“吞掉并返回 0”，会把“Qdrant 未就绪/不可达”伪装成“集合为空”
     * - 启动维护据此会误判为“向量库缺失”，触发全量破坏性清理
     *
     * 因此这里不再吞错：让上层决定是重试/跳过，而不是把未知状态降级成 0。
     */
    const info = await this.qdrantAdapter.getCollection(collectionName);
    return {
      vectors_count: info.vectors_count ?? 0,
      indexed_vectors_count: info.indexed_vectors_count ?? 0,
      points_count: info.points_count ?? 0,
      segments_count: info.segments_count ?? 0,
      config: info.config ?? {}
    };
  }

  /**
   * 功能：根据 collection 当前 points_count 动态校准目标段数。
   *
   * 说明：
   * - 小 collection 目标收敛到 1/2/4 段，减少固定磁盘底座；
   * - 超过阈值后回退到 Qdrant 自动策略（`default_segment_number = 0`）。
   */
  async reconcileCollectionSegmentTarget(
    collectionName: string
  ): Promise<CollectionSegmentReconcileResult> {
    return await reconcileCollectionSegmentTargetImpl({
      collectionName,
      logger: this.logger,
      getCollectionInfo: async () => await this.getCollectionInfo(collectionName),
      updateCollection: async (updateConfig) => {
        await this.qdrantAdapter.updateCollection(collectionName, updateConfig);
      },
    });
  }

  resolveInitialChunkCollectionSegmentTarget(): number {
    return resolveTargetSegmentCountByPointsCount(0);
  }

  async runWithCollectionAccess<T>(
    collectionName: string,
    mode: CollectionAccessMode,
    action: () => Promise<T>
  ): Promise<T> {
    return await runWithCollectionAccess(collectionName, mode, action);
  }

  async recreateChunkCollectionIfNeeded(
    collectionName: string
  ): Promise<ChunkCollectionRecreateResult> {
    return await this.runWithCollectionAccess(collectionName, 'exclusive', async () => {
      return await recreateChunkCollectionIfNeededImpl({
        collectionName,
        logger: this.logger,
        collectionExists: async () => await this.collectionExists(collectionName),
        getCollectionInfo: async () => {
          const info = await this.getCollectionInfo(collectionName);
          return {
            points_count: info.points_count,
            segments_count: info.segments_count,
            config: info.config,
          };
        },
        scrollPointsPageWithVector: async (limit, offset) =>
          await this.qdrantAdapter.scrollPointsPageWithVector(collectionName, limit, offset),
        deleteCollection: async () => {
          await this.qdrantAdapter.deleteCollection(collectionName);
        },
        createCollection: async ({ vectorSize, defaultSegmentNumber }) => {
          const vectorConfig: MultiVectorCollectionConfig = {
            default: {
              size: vectorSize,
              distance: 'Cosine',
            },
            bm25: {},
          };
          await this.qdrantAdapter.createCollection(collectionName, vectorConfig, 'Cosine', {
            optimizerConfig: {
              defaultSegmentNumber,
            },
          });
        },
        upsertPoints: async (points) => {
          await this.qdrantAdapter.upsertPoints(
            collectionName,
            points.map((point) => ({
              id: point.id,
              vector: point.vector,
              payload: point.payload,
            }))
          );
        },
        countPoints: async () =>
          await this.qdrantAdapter.countPoints(collectionName, {
            exact: true,
          }),
      });
    });
  }
}
