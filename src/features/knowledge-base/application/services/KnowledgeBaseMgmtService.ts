/**
 * @file src/knowledge-base/application/services/KnowledgeBaseMgmtService.ts
 *
 * @brief 知识库管理服务 - 负责 KnowledgeBase 实体本身的 CRUD（不包含文档摄入/搜索）
 *
 * @description
 * 功能 (What):
 * - 创建/查询/更新/删除知识库
 * - 维护 default 知识库的存在性（缺省 kbId 时会用到）
 *
 * 设计边界（高内聚低耦合）：
 * - 本服务只处理“知识库实体”层面的事情（元数据 + 向量集合生命周期）
 * - 文档相关逻辑在 `DocumentService`，摄入在 `IngestionService`，搜索在 `SearchService`
 */

import { generateTaskId } from '@shared/utils/idUtils';
import { DEFAULT_VECTOR_DIMENSION } from '@shared/constants';
import { Logger } from 'src/shared/logger';
import { KnowledgeBase, createKnowledgeBase } from '../../domain/knowledgeBase';
import { MetadataRepository } from '../../infrastructure/metadataRepository';
import { QdrantRepository } from '../../infrastructure/qdrantRepository';
import { SotRepository } from '../../infrastructure/sotRepository';
import type { OriginalDocumentRepository } from '../../infrastructure/originalDocumentRepository';
import { resolveTargetSegmentCountByPointsCount } from '../../infrastructure/qdrant-repository/segmentPolicy';
import { KnowledgeBaseWithDocumentCount } from '../knowledgeBaseService';
import { getGraphEdgesCollectionName, getGraphNodesCollectionName } from '../../graph/infrastructure/qdrantCollections';
import {
  KnowledgeBaseDefaultDeleteBlockedError,
  KnowledgeBaseIdRequiredError,
  KnowledgeBaseNameRequiredError,
  KnowledgeBaseNotFoundError,
  KnowledgeBaseReadAfterUpdateFailedError,
} from '../../definitions/knowledgeBaseErrors';

const logger = new Logger('KnowledgeBaseMgmtService');

export interface KnowledgeBaseMgmtServiceDeps {
  metadataRepository: MetadataRepository;
  qdrantRepository: QdrantRepository;
  sotRepository: SotRepository;
  originalDocumentRepository: OriginalDocumentRepository;
}

export class KnowledgeBaseMgmtService {
  private readonly metadataRepository: MetadataRepository;
  private readonly qdrantRepository: QdrantRepository;
  private readonly sotRepository: SotRepository;
  private readonly originalDocumentRepository: OriginalDocumentRepository;

  constructor(deps: KnowledgeBaseMgmtServiceDeps) {
    this.metadataRepository = deps.metadataRepository;
    this.qdrantRepository = deps.qdrantRepository;
    this.sotRepository = deps.sotRepository;
    this.originalDocumentRepository = deps.originalDocumentRepository;
  }

  /**
   * **功能 (What):** 创建新的知识库
   * **副作用 (Side-effects):**
   * - 写入元数据
   * - 创建对应的 Qdrant 集合（必须从创建开始就支持稀疏向量 bm25）
   */
  async createKnowledgeBase(name: string, description?: string): Promise<KnowledgeBase> {
    logger.info(`创建知识库: ${name}`);

    if (!name || name.trim().length === 0) {
      throw new KnowledgeBaseNameRequiredError();
    }

    try {
      const kbId = generateTaskId(); // 临时使用taskId生成器，后续可替换为专门的 KB ID 生成器
      const kb = createKnowledgeBase(kbId, name.trim(), description);

      await this.metadataRepository.createKnowledgeBase(kb);

      // 重要：集合必须从创建开始就支持稀疏向量（bm25），否则后续摄入会在 STORING 阶段失败。
      // 同时我们统一使用命名向量 default（见 QdrantAdapter.createCollection 的实现）。
      await this.qdrantRepository.getOrCreateCollection(kbId, DEFAULT_VECTOR_DIMENSION, 'Cosine', true, {
        // chunk collection 从创建开始就收敛到小库目标段数，避免先按 Qdrant 默认多段起步。
        defaultSegmentNumber: resolveTargetSegmentCountByPointsCount(0),
      });

      logger.info(`知识库创建成功: ${kbId}`);
      return kb;
    } catch (error) {
      logger.error(`创建知识库失败: ${error}`);
      throw error;
    }
  }

  /**
   * 获取所有知识库列表
   */
  async getAllKnowledgeBases(): Promise<KnowledgeBaseWithDocumentCount[]> {
    logger.info('获取所有知识库列表');
    try {
      const knowledgeBases = await this.metadataRepository.getAllKnowledgeBases();
      const kbIds = knowledgeBases.map((kb) => kb.id);
      const countsByKbId = await this.metadataRepository.getDocumentCountsByKnowledgeBaseIds(kbIds);

      const withCounts: KnowledgeBaseWithDocumentCount[] = knowledgeBases.map((kb) => {
        const raw = countsByKbId[kb.id];
        const documentCount =
          typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.trunc(raw) : 0;
        return { ...kb, documentCount };
      });

      logger.info(`找到 ${knowledgeBases.length} 个知识库（已附加 documentCount）`);
      return withCounts;
    } catch (error) {
      logger.error(`获取知识库列表失败: ${error}`);
      throw error;
    }
  }

  /**
   * 获取或创建默认知识库
   *
   * 说明：
   * - 目前 default KB 使用固定 id = 'default'（与历史数据 / IPC 契约保持一致）
   */
  async getOrCreateDefaultKnowledgeBase(): Promise<KnowledgeBase> {
    logger.info('获取或创建默认知识库');

    try {
      const existingKb = await this.metadataRepository.getKnowledgeBaseById('default');
      if (existingKb) {
        logger.info('默认知识库已存在');
        return existingKb;
      }

      logger.info('创建新的默认知识库');
      const defaultKb = createKnowledgeBase('default', '默认知识库', '系统默认创建的知识库');

      await this.metadataRepository.createKnowledgeBase(defaultKb);
      // 默认知识库同样需要支持 bm25 稀疏向量，保证混合检索/写入链路一致。
      await this.qdrantRepository.getOrCreateCollection('default', DEFAULT_VECTOR_DIMENSION, 'Cosine', true, {
        // default chunk collection 也应从创建时直接落到目标段数，避免历史膨胀根因重演。
        defaultSegmentNumber: resolveTargetSegmentCountByPointsCount(0),
      });

      logger.info('默认知识库创建成功');
      return defaultKb;
    } catch (error) {
      logger.error(`获取或创建默认知识库失败: ${error}`);
      throw error;
    }
  }

  async getKnowledgeBaseById(kbId: string): Promise<KnowledgeBase | undefined> {
    if (!kbId || kbId.trim().length === 0) {
      throw new KnowledgeBaseIdRequiredError('read');
    }
    return this.metadataRepository.getKnowledgeBaseById(kbId);
  }

  /**
   * 删除一个知识库及其包含的所有文档和数据
   */
  async deleteKnowledgeBase(kbId: string): Promise<void> {
    logger.info(`删除知识库 ${kbId}`);

    if (!kbId || kbId.trim().length === 0) {
      throw new KnowledgeBaseIdRequiredError('delete');
    }

    try {
      // 检查是否为默认知识库
      if (kbId === 'default') {
        throw new KnowledgeBaseDefaultDeleteBlockedError();
      }

      const existing = await this.metadataRepository.getKnowledgeBaseById(kbId);
      if (!existing) {
        throw new KnowledgeBaseNotFoundError(kbId);
      }

      // 1) 获取此知识库中的所有文档（用于清理 SoT）
      const documents = await this.metadataRepository.getDocumentsInKnowledgeBase(kbId);

      /**
       * 说明（重要）：
       * - “知识库文档的原始上传文件”在摄入完成时会作为临时文件被清理（见 StoringHandler.cleanupTempFiles -> fs.unlink）。
       * - 因此删除知识库时，磁盘侧需要清理的是 SoT（Source of Truth）对应的 `*.source.json` 文件。
       * - 这类文件以 docId 为 key 存在于 `pathManager.getSourceOfTruthPath()` 目录下。
       */
      logger.info(`知识库 ${kbId} 共包含 ${documents.length} 个文档，开始清理 SoT 文件`);
      if (documents.length > 0) {
        // 避免日志过长：只打印前 20 个文档的 id + 文件名预览
        const preview = documents
          .slice(0, 20)
          .map((d) => `${d.id}:${d.filename}`)
          .join(', ');
        logger.info(
          `待清理文档预览（最多 20 个）: ${preview}${documents.length > 20 ? ' ...' : ''}`
        );
      }

      // 2) 删除每个文档的 SoT 数据（向量点会被 deleteCollection 级联删除）
      let sotDeletedCount = 0;
      let sotMissingOrFailedCount = 0;
      for (const doc of documents) {
        const deleted = await this.sotRepository.delete(doc.id);
        if (deleted) {
          sotDeletedCount += 1;
        } else {
          sotMissingOrFailedCount += 1;
          // false 表示文件不存在或删除失败（FileSotRepository.delete 内部会吞掉 unlink 异常并返回 false）
          logger.warn(`SoT 文件不存在或删除失败: docId=${doc.id}, filename=${doc.filename}`);
        }
      }
      logger.info(
        `SoT 清理完成: deleted=${sotDeletedCount}, missingOrFailed=${sotMissingOrFailedCount}`
      );

      const originalDeletedCount = await this.originalDocumentRepository.deleteByKnowledgeBase(kbId);
      logger.info(`原始 PDF 清理完成: deleted=${originalDeletedCount}`);

      // 3) 删除知识库集合（这会级联删除所有向量点）
      logger.info(`开始删除 Qdrant 集合（将级联删除向量点）: ${kbId}`);
      await this.qdrantRepository.deleteCollection(kbId);

      /**
       * 3.5) 删除 Soft Knowledge Graph 的向量集合（若存在）
       *
       * 说明：
       * - 图谱向量化使用独立 collection（kg_nodes_${kbId} / kg_edges_${kbId}）；
       * - 对“未启用图谱向量化”的知识库，这两个集合可能不存在，因此这里必须先做存在性检查。
       */
      const kgNodesCollection = getGraphNodesCollectionName(kbId);
      const kgEdgesCollection = getGraphEdgesCollectionName(kbId);
      if (await this.qdrantRepository.collectionExists(kgNodesCollection)) {
        logger.info(`开始删除图谱 nodes 集合: ${kgNodesCollection}`);
        await this.qdrantRepository.deleteCollection(kgNodesCollection);
      }
      if (await this.qdrantRepository.collectionExists(kgEdgesCollection)) {
        logger.info(`开始删除图谱 edges 集合: ${kgEdgesCollection}`);
        await this.qdrantRepository.deleteCollection(kgEdgesCollection);
      }

      // 4) 删除元数据（这会级联删除所有文档元数据）
      logger.info(`开始删除知识库元数据（workspace.sqlite，将级联删除 kb_documents）: ${kbId}`);
      // 说明：Soft Knowledge Graph 的 knowledge_graph_* 表对 knowledge_bases(id) 有外键（ON DELETE CASCADE），
      // 因此删除 knowledge_bases 会自动级联清理该 kbId 的图谱数据，无需在此处额外删除（避免中间态不一致）。
      await this.metadataRepository.deleteKnowledgeBase(kbId);

      logger.info(`知识库 ${kbId} 已成功删除`);
    } catch (error) {
      logger.error(`删除知识库 ${kbId} 失败: ${error}`);
      throw error;
    }
  }

  /**
   * 更新知识库的基础信息 / 模型配置 / 标签
   */
  async updateKnowledgeBaseSettings(
    kbId: string,
    payload: {
      name?: string;
      description?: string | null;
      embeddingModelId?: string | null;
      rerankModelId?: string | null;
      pdfOcrModelId?: string | null;
      imageVisionModelId?: string | null;
      visionModelId?: string | null;
      tags?: string[];
      enableGraphIndexing?: boolean;
    }
  ): Promise<KnowledgeBase> {
    logger.info(`[KnowledgeBaseMgmtService] 更新知识库配置: ${kbId}`);

    if (!kbId || kbId.trim().length === 0) {
      throw new KnowledgeBaseIdRequiredError('update');
    }

    try {
      const existing = await this.metadataRepository.getKnowledgeBaseById(kbId);
      if (!existing) {
        throw new KnowledgeBaseNotFoundError(kbId);
      }

      await this.metadataRepository.updateKnowledgeBase(kbId, payload);

      const updated = await this.metadataRepository.getKnowledgeBaseById(kbId);
      if (!updated) {
        throw new KnowledgeBaseReadAfterUpdateFailedError(kbId);
      }

      logger.info(`[KnowledgeBaseMgmtService] 知识库 ${kbId} 配置更新成功`);
      return updated;
    } catch (error) {
      logger.error(`[KnowledgeBaseMgmtService] 更新知识库 ${kbId} 配置失败: ${error}`);
      throw error;
    }
  }
}
