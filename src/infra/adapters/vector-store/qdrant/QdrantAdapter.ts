/**
 * @file src/infra/adapters/vector-store/qdrant/QdrantAdapter.ts
 *
 * @brief Qdrant 向量数据库适配器（对外主入口）
 *
 * @description
 * - 对外提供统一 API：upsert/search/scroll/collection/delete
 * - 对内按能力拆分到独立模块，提升可维护性与可测试性
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { Logger } from 'src/shared/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { pathManager } from 'src/shared/utils/pathManager';

import type {
  CreateCollectionOptions,
  DeleteParams,
  Distance,
  MultiVectorCollectionConfig,
  QdrantCollectionInfo,
  QdrantConfig,
  QdrantScrollOffset,
  SearchParams,
  SearchResult,
  UpsertResult,
  VectorPoint
} from './types';

import { normalizeUpsertPoints, parseUpsertResult } from './points/normalizeUpsertPoints';
import { retrievePointsImpl } from './points/retrievePoints';
import { searchPointsImpl } from './search/searchPoints';
import { scrollPointsPageImpl } from './scroll/scrollPointsPage';
import { scrollPointsPageWithVectorImpl } from './scroll/scrollPointsPageWithVector';
import { deletePointsImpl } from './delete/deletePoints';
import { createCollectionImpl } from './collections/createCollection';
import { updateCollectionImpl } from './collections/updateCollection';
import { getCollectionImpl } from './collections/getCollection';
import { extractHttpStatusCode, QdrantRequestError } from './errors';

const logger = new Logger('qdrant-adapter');

/**
 * Qdrant 向量数据库适配器
 */
export class QdrantAdapter {
  private static instance: QdrantAdapter | null = null;
  private readonly client: QdrantClient;
  private readonly config: QdrantConfig;

  private constructor(config: QdrantConfig) {
    this.config = config;
    this.client = new QdrantClient({
      url: config.url,
      apiKey: config.apiKey,
      timeout: config.timeout ?? 30000,
      // 开发环境下更关注可用性：默认跳过 client-server 版本兼容性检查
      checkCompatibility: config.checkCompatibility ?? false
    });
  }

  /**
   * 获取单例实例
   */
  static getInstance(config: QdrantConfig): QdrantAdapter {
    if (!QdrantAdapter.instance) {
      QdrantAdapter.instance = new QdrantAdapter(config);
    }
    return QdrantAdapter.instance;
  }

  /**
   * 重置单例实例（主要用于测试）
   */
  static resetInstance(): void {
    QdrantAdapter.instance = null;
  }

  /**
   * 批量插入或更新向量点（支持命名向量）
   */
  async upsertPoints(collectionName: string, points: VectorPoint[]): Promise<UpsertResult> {
    try {
      logger.debug(`[QdrantAdapter] Upserting ${points.length} points to collection: ${collectionName}`);

      const processedPoints = normalizeUpsertPoints(points, logger);

      const upsertRequest = {
        wait: true,
        // 这里的 vector 结构由 normalizeUpsertPoints 严格生成；SDK 接受命名向量对象
        points: processedPoints
      };

      logger.debug(`[QdrantAdapter] 准备存储 ${processedPoints.length} 个向量点到集合: ${collectionName}`);
      const rawResult = await this.client.upsert(collectionName, upsertRequest);
      logger.debug(`[QdrantAdapter] Upsert completed for collection: ${collectionName}`);

      return parseUpsertResult(rawResult);
    } catch (error) {
      logger.error(`[QdrantAdapter] Upsert failed for collection: ${collectionName}`);
      logger.error(`[QdrantAdapter] Error details: ${String(error)}`);
      throw error;
    }
  }

  /**
   * 向量相似性搜索
   */
  async searchPoints(collectionName: string, params: SearchParams): Promise<SearchResult[]> {
    try {
      return await searchPointsImpl(this.client, collectionName, params, logger);
    } catch (error) {
      logger.error(`[QdrantAdapter] Search failed for collection: ${collectionName}`, error);
      throw error;
    }
  }

  /**
   * 滚动获取集合中点的元数据（单页）
   */
  async scrollPointsPage(
    collectionName: string,
    limit: number = 1000,
    offset?: QdrantScrollOffset
  ): Promise<{
    points: Array<{ id: string; payload: Record<string, unknown> }>;
    nextOffset?: QdrantScrollOffset;
  }> {
    try {
      return await scrollPointsPageImpl(this.client, collectionName, limit, offset, logger);
    } catch (error) {
      logger.error(`[QdrantAdapter] Scroll failed:`, error);
      throw error;
    }
  }

  /**
   * 滚动获取集合中点的元数据 + 向量（单页）
   *
   * 说明：
   * - 仅用于诊断（例如“点存在但语义检索 0 命中”）；
   * - 正常业务链路默认不取向量，避免额外开销。
   */
  async scrollPointsPageWithVector(
    collectionName: string,
    limit: number = 1000,
    offset?: QdrantScrollOffset
  ): Promise<{
    points: Array<{ id: string; payload: Record<string, unknown>; vector: unknown }>;
    nextOffset?: QdrantScrollOffset;
  }> {
    try {
      return await scrollPointsPageWithVectorImpl(this.client, collectionName, limit, offset, logger);
    } catch (error) {
      logger.error(`[QdrantAdapter] Scroll(with_vector) failed:`, error);
      throw error;
    }
  }

  /**
   * 滚动获取集合中点的元数据 + 向量（便捷方法，只取第一页）
   */
  async scrollPointsWithVector(
    collectionName: string,
    limit: number = 10000
  ): Promise<Array<{ id: string; payload: Record<string, unknown>; vector: unknown }>> {
    const page = await this.scrollPointsPageWithVector(collectionName, limit, undefined);
    return page.points;
  }

  /**
   * 滚动获取集合中点的元数据（便捷方法，只取第一页）
   */
  async scrollPoints(
    collectionName: string,
    limit: number = 10000
  ): Promise<Array<{ id: string; payload: Record<string, unknown> }>> {
    const page = await this.scrollPointsPage(collectionName, limit, undefined);
    return page.points;
  }

  /**
   * 按 point id 精确读取点。
   *
   * 说明：用于增量提交点校验，避免为了校验少量新增点而全库 scroll。
   */
  async retrievePoints(
    collectionName: string,
    pointIds: string[]
  ): Promise<Array<{ id: string; payload: Record<string, unknown> }>> {
    try {
      return await retrievePointsImpl(this.client, collectionName, pointIds, logger);
    } catch (error) {
      logger.error(`[QdrantAdapter] Retrieve failed:`, error);
      throw error;
    }
  }

  /**
   * 统计集合内点数量（可选按 filter 限定）
   *
   * 说明：
   * - 用于业务层“提交点校验”（例如按 doc_id 统计写入是否成功）
   * - 比 scroll 全量扫描更轻量
   */
  async countPoints(
    collectionName: string,
    options?: {
      filter?: Record<string, unknown>;
      exact?: boolean;
    }
  ): Promise<number> {
    const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
    const extractCountOrThrow = (v: unknown): number => {
      if (!isRecord(v)) {
        throw new Error(`[QdrantAdapter] countPoints 返回非对象响应: ${String(v)}`);
      }
      const count = v['count'];
      if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
        throw new Error(`[QdrantAdapter] countPoints 返回无效 count 字段: ${JSON.stringify(v)}`);
      }
      return count;
    };

    const exact = options?.exact ?? true;
    const filter = options?.filter;

    // @qdrant/js-client-rest: count(collectionName, { filter?, exact? })
    const raw = await this.client.count(collectionName, {
      exact,
      ...(filter ? { filter } : {})
    });
    return extractCountOrThrow(raw);
  }

  /**
   * 删除向量点
   */
  async deletePoints(collectionName: string, params: DeleteParams): Promise<void> {
    try {
      await deletePointsImpl(this.client, collectionName, params, logger);
    } catch (error) {
      logger.error(`[QdrantAdapter] Delete failed for collection: ${collectionName}`, error);
      throw error;
    }
  }

  /**
   * 检查集合是否存在
   */
  async collectionExists(collectionName: string): Promise<boolean> {
    try {
      await this.client.getCollection(collectionName);
      return true;
    } catch (err) {
      /**
       * 根因修复：
       * - 旧实现把所有异常都当成“不存在”，会把“Qdrant 未启动/超时”等误判为“空库”
       * - 在启动维护场景下会触发灾难性的全量清理（把用户内容当失败并删除）
       *
       * 这里必须区分：
       * - 404：集合确实不存在（返回 false）
       * - 其它：Qdrant 不可达/未就绪/超时（抛错，让上层停止破坏性动作并重试）
       */
      const status = extractHttpStatusCode(err);
      if (status === 404) return false;

      logger.warn(
        `[QdrantAdapter] collectionExists 失败（非404，视为服务不可用）: collection=${collectionName}, status=${typeof status === 'number' ? status : 'unknown'}`
      );
      throw new QdrantRequestError(
        `Qdrant collectionExists failed (service unavailable): ${collectionName}`,
        { httpStatus: status, cause: err }
      );
    }
  }

  /**
   * 获取集合的详细信息（收敛为项目用到的最小字段集）
   */
  async getCollection(collectionName: string): Promise<QdrantCollectionInfo> {
    return await getCollectionImpl(this.client, collectionName, logger);
  }

  /**
   * 创建集合（支持命名向量 default 与可选 bm25 稀疏向量）
   */
  async createCollection(
    collectionName: string,
    vectorConfigOrSize: number | MultiVectorCollectionConfig,
    distance: Distance = 'Cosine',
    options?: CreateCollectionOptions
  ): Promise<void> {
    await createCollectionImpl(this.config, collectionName, vectorConfigOrSize, distance, logger, options);
  }

  /**
   * 更新集合配置
   */
  async updateCollection(collectionName: string, updateConfig: Record<string, unknown>): Promise<void> {
    await updateCollectionImpl(this.config, collectionName, updateConfig, logger);
  }

  /**
   * 删除集合
   */
  async deleteCollection(collectionName: string): Promise<void> {
    logger.info(`[QdrantAdapter] Deleting collection: ${collectionName}`);
    try {
      // 说明：timeout 单位为秒。这里给一个更宽松的提交等待时间，避免在慢盘/大集合上误判为超时。
      await this.client.deleteCollection(collectionName, { timeout: 120 });
      logger.info(`[QdrantAdapter] Collection deleted via SDK: ${collectionName}`);
    } catch (error: any) {
      /**
       * 根因修复（Windows os error 5: 拒绝访问）：
       * - 即使配置了 memmap_threshold_kb 禁用 mmap，Windows 上仍可能因文件句柄/锁占用导致 Qdrant 无法删除目录
       * - 此时 Qdrant 会抛出 500 Service internal error: 拒绝访问
       * - 策略：既然 Qdrant 进程删不掉，我们在 Node 侧尝试强制物理删除（兜底）
       */
      const isAccessDenied =
        JSON.stringify(error).includes('os error 5') ||
        JSON.stringify(error).includes('拒绝访问') ||
        (error?.status === 500);

      if (isAccessDenied) {
        logger.warn(
          `[QdrantAdapter] SDK 删除集合失败 (os error 5 / 500)，尝试物理删除目录兜底: ${collectionName}`
        );
        try {
          // 物理路径：WorkspaceRoot/KnowledgeBase/qdrant/storage/collections/{name}
          // 注意：必须与 qdrantManager.ts 中的 dataDir + storage_path 保持一致
          const collectionPath = path.join(
            pathManager.getKbDataPath(),
            'qdrant',
            'storage',
            'collections',
            collectionName
          );

          // 检查目录是否存在
          await fs.access(collectionPath);
          // 强制递归删除
          await fs.rm(collectionPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
          logger.info(`[QdrantAdapter] 物理目录已强制删除: ${collectionPath}`);
          return; // 兜底成功，视为删除成功
        } catch (fsError: any) {
          if (fsError.code === 'ENOENT') {
            logger.info(`[QdrantAdapter] 物理目录不存在，视为已删除: ${collectionName}`);
            return;
          }
          // 如果物理删除也失败（例如被杀毒软件锁死），则只能抛出原始错误
          logger.error(`[QdrantAdapter] 物理删除也失败: ${fsError.message}`);
        }
      }
      // 非 os error 5 或物理删除也失败 -> 抛出异常
      throw error;
    }
  }

  /**
   * 根据文档ID删除所有相关块
   */
  async deleteByDocId(collectionName: string, docId: string): Promise<void> {
    await this.deletePoints(collectionName, {
      filter: {
        must: [
          {
            key: 'doc_id',
            match: { value: docId }
          }
        ]
      }
    });
  }

  /**
   * 根据块ID删除特定块
   */
  async deleteByBlockId(collectionName: string, blockId: string): Promise<void> {
    await this.deletePoints(collectionName, {
      points: [blockId]
    });
  }

  /**
   * 获取客户端配置信息
   */
  getConfig(): QdrantConfig {
    return { ...this.config };
  }
}

