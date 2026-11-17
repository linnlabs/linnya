/**
 * @file src/knowledge-base/application/services/DocumentService.ts
 * 
 * @brief 文档服务 - 负责文档的CRUD操作和状态管理
 * 
 * @description
 * 功能 (What): 处理文档的增删改查、状态查询、批量状态获取等操作
 * 输入 (Input): 文档ID、知识库ID、文档列表等参数
 * 输出 (Output): 文档对象、状态信息、操作结果
 * 副作用 (Side-effects): 更新元数据数据库、操作向量数据库、管理SoT存储
 */

import { Document, DocumentStatus } from '../../domain/document';
import { Logger } from 'src/shared/logger';
import { TaskStatusView } from '../knowledgeBaseService';
import { MetadataRepository } from '../../infrastructure/metadataRepository';
import { QdrantRepository } from '../../infrastructure/qdrantRepository';
import { SotRepository } from '../../infrastructure/sotRepository';
import type { OriginalDocumentRepository } from '../../infrastructure/originalDocumentRepository';
import type { KnowledgeGraphRepository } from '../../graph/infrastructure/knowledgeGraphRepository';
import { getGraphEdgesCollectionName, getGraphNodesCollectionName } from '../../graph/infrastructure/qdrantCollections';
import { hasCollectionAccessCoordinator } from '../../infrastructure/qdrant-repository/collectionAccess';
import {
  getIngestionProgress,
  type IngestionProgressSnapshot,
} from '../../ingestion/store/ingestionProgressStore';

const logger = new Logger('DocumentService');

/**
 * 文档服务依赖接口
 */
export interface DocumentServiceDeps {
  metadataRepository: MetadataRepository;
  qdrantRepository: QdrantRepository;
  sotRepository: SotRepository;
  originalDocumentRepository: OriginalDocumentRepository;
  /**
   * Soft Knowledge Graph 的 SQLite 仓储（用于删除一致性清理）。
   *
   * 说明：
   * - 图谱数据与元数据同属于 workspace.sqlite
   * - 删除文档时必须同步清理图谱数据，避免残留进度/增强引用
   */
  knowledgeGraphRepository: KnowledgeGraphRepository;
}

/**
 * 功能 (What): 文档服务类，处理文档相关的所有操作
 * 输入 (Input): 依赖注入的各种Repository
 * 输出 (Output): 文档操作的业务逻辑封装
 * 副作用 (Side-effects): 协调多个数据源的操作，确保数据一致性
 */
export class DocumentService {
  private readonly metadataRepository: MetadataRepository;
  private readonly qdrantRepository: QdrantRepository;
  private readonly sotRepository: SotRepository;
  private readonly originalDocumentRepository: OriginalDocumentRepository;
  private readonly knowledgeGraphRepository: KnowledgeGraphRepository;

  constructor(deps: DocumentServiceDeps) {
    this.metadataRepository = deps.metadataRepository;
    this.qdrantRepository = deps.qdrantRepository;
    this.sotRepository = deps.sotRepository;
    this.originalDocumentRepository = deps.originalDocumentRepository;
    this.knowledgeGraphRepository = deps.knowledgeGraphRepository;
  }

  /**
   * **功能 (What):** 获取指定知识库中的所有文档列表。
   * **输入 (Input / @param):** 
   * @param kbId - (string) 知识库的ID。
   * **输出 (Output / @returns):** `Promise<Document[]>` - 该知识库中所有文档的数组。
   * **副作用 (Side-effects):** 从元数据仓储中查询文档信息。
   */
  async getDocumentsInKnowledgeBase(kbId: string): Promise<Document[]> {
    logger.info(`获取知识库 ${kbId} 中的文档列表`);
    
    try {
      const documents = await this.metadataRepository.getDocumentsInKnowledgeBase(kbId);
      logger.info(`知识库 ${kbId} 包含 ${documents.length} 个文档`);
      return documents;
    } catch (error) {
      logger.error(`获取知识库 ${kbId} 文档列表失败: ${error}`);
      throw error;
    }
  }

  /**
   * **功能 (What):** 批量获取多个文档（任务）的处理状态，将任务状态转换为前端友好的格式。
   * **输入 (Input / @param):** 
   * @param docIds - (string[]) 文档ID数组，这些ID同时也作为任务ID使用。
   * **输出 (Output / @returns):** `Promise<Record<string, TaskStatusView>>` - 以文档ID为键，状态视图对象为值的字典。
   * **副作用 (Side-effects):** 查询摄取进度读模型，并进行状态映射转换。
   */
  async getTasksStatus(docIds: string[]): Promise<Record<string, TaskStatusView>> {
    logger.info(`批量获取 ${docIds.length} 个任务的状态: [${docIds.join(', ')}]`);
    
    const result: Record<string, TaskStatusView> = {};
    
    for (const docId of docIds) {
      try {
        const progressSnapshot = getIngestionProgress(docId);
        
        if (progressSnapshot) {
          /**
           * 轮询接口必须返回摄取进度读模型的权威字段，不得降级为粗粒度 50%。
           *
           * 现象：
           * - 前端即使 IPC 可用，也会做低频“校准轮询”；
           * - 如果轮询返回缺失 stage/stage_progress/progress，前端会把 realProgress 卡在旧值，
           *   进度条经动画超前后停留在 89% 等看似“卡死”的位置。
           *
           * 约束：
           * - status 必须保持五态：pending/processing/completed/failed/duplicate
           * - stage 允许为空字符串，processing 时建议为 parsing/embedding/storing 之一
           * - progress 必须是 0-100 的绝对进度（可选，但若缺失会影响 UI 校准）
           */
          const status = progressSnapshot.status;
          const stage = typeof progressSnapshot.stage === 'string' ? progressSnapshot.stage : '';
          const stageProgress =
            typeof progressSnapshot.stage_progress === 'number' && Number.isFinite(progressSnapshot.stage_progress)
              ? progressSnapshot.stage_progress
              : undefined;
          const progress =
            typeof progressSnapshot.progress === 'number' && Number.isFinite(progressSnapshot.progress)
              ? progressSnapshot.progress
              : this.calculateProgressFromStatus(status);

          const statusView: TaskStatusView = {
            taskId: docId,
            docId: docId,
            status,
            progress,
            stage,
            stage_progress: stageProgress,
            message: progressSnapshot.message,
            error: progressSnapshot.error,
            updatedAt: progressSnapshot.updated_at,
            estimatedTimeRemaining: this.calculateEstimatedTimeRemaining(progressSnapshot),
          };
          
          result[docId] = statusView;
          logger.debug(`任务 ${docId} 状态: ${statusView.status} (${statusView.progress}%)`);
        } else {
          // 读模型中没有快照时，再从元数据仓储读取持久化文档状态。
          try {
            const document = await this.metadataRepository.getDocumentById(docId);
            if (document) {
              result[docId] = {
                taskId: docId,
                docId: docId,
                status: document.status,
                progress: document.status === DocumentStatus.COMPLETED ? 100 : 0,
                stage: document.status === DocumentStatus.COMPLETED ? 'completed' : '',
                stage_progress: document.status === DocumentStatus.COMPLETED ? 100 : 0,
                message: document.status === DocumentStatus.COMPLETED ? '已完成' : '等待中',
                error: undefined,
                updatedAt: document.updatedAt || document.createdAt,
                estimatedTimeRemaining: undefined
              };
              logger.debug(`从元数据获取任务 ${docId} 状态: ${document.status}`);
            }
          } catch (metadataError) {
            logger.error(`无法从元数据仓储获取文档 ${docId} 的状态: ${metadataError}`);
          }
        }
      } catch (error) {
        logger.error(`获取任务 ${docId} 状态失败: ${error}`);
        // 为失败的任务设置默认状态
        result[docId] = {
          taskId: docId,
          docId: docId,
          status: DocumentStatus.FAILED,
          progress: 0,
          stage: 'failed',
          error: `获取状态失败: ${error instanceof Error ? error.message : String(error)}`,
          updatedAt: Date.now(),
          estimatedTimeRemaining: undefined
        };
      }
    }
    
    logger.info(`批量状态查询完成，返回 ${Object.keys(result).length} 个任务状态`);
    return result;
  }

  /**
   * **功能 (What):** 从知识库中彻底删除一个文档及其所有关联数据。
   * **输入 (Input / @param):**
   * @param kbId - (string) 知识库的ID。
   * @param docId - (string) 要删除的文档的ID。
   * **输出 (Output / @returns):** `Promise<void>`，如果删除失败则会抛出错误。
   * **副作用 (Side-effects):**
   * 1. 从元数据仓储 (metadataRepository) 中删除文档记录。
   * 2. 从向量数据库 (qdrantRepository) 中删除该文档对应的所有向量点。
   * 3. 从SoT (Source of Truth) 存储 (sotRepository) 中删除文档的原始内容文件。
   */
  async deleteDocument(kbId: string, docId: string): Promise<void> {
    logger.info(`从知识库 ${kbId} 删除文档 ${docId}`);
    
    try {
      const executeDelete = async (): Promise<void> => {
        /**
         * 关键一致性约束（根因修复）：
         * - 搜索结果来自向量库（Qdrant），浏览/列表来自元数据（workspace.sqlite）。
         * - 如果先删元数据、后删向量，一旦向量删除失败，就会产生“Qdrant 仍有 doc_id，但元数据已无记录”的孤儿数据，
         *   最终表现为：search 能搜到、browse 提示 Document not found。
         *
         * 因此删除顺序必须是：先删向量/SoT（可重试），最后删元数据（不可恢复的“对外不存在”信号）。
         */

        // 1) 从向量数据库中删除文档的所有向量点（若集合不存在则视为无向量数据，无需删除）
        const collectionExists = await this.qdrantRepository.collectionExists(kbId);
        if (collectionExists) {
          await this.qdrantRepository.deletePointsByDocId(kbId, docId);
        } else {
          logger.warn(`Qdrant 集合不存在，跳过向量删除: kbId=${kbId}, docId=${docId}`);
        }

        /**
         * 1.5) 删除“图谱向量索引”的向量点（nodes/edges 两个集合）
         *
         * 设计说明（根因修复）：
         * - 图谱向量索引与文档 chunk 向量是两套 collection；
         * - 删除文档时，必须同时删掉该 doc_id 对应的图谱点，否则会出现：
         *   - Graph Search(full) 仍能召回已删除 doc 的图谱陈述
         */
        const kgNodesCollection = getGraphNodesCollectionName(kbId);
        const kgEdgesCollection = getGraphEdgesCollectionName(kbId);

        const kgNodesExists = await this.qdrantRepository.collectionExists(kgNodesCollection);
        if (kgNodesExists) {
          await this.qdrantRepository.deletePointsByDocId(kgNodesCollection, docId);
        }

        const kgEdgesExists = await this.qdrantRepository.collectionExists(kgEdgesCollection);
        if (kgEdgesExists) {
          await this.qdrantRepository.deletePointsByDocId(kgEdgesCollection, docId);
        }

        // 2) 从SoT存储中删除文档（SoT 以 docId 为 key，与 kbId 无关）
        await this.sotRepository.delete(docId);

        // 2.25) 删除原始 PDF。该仓储只保存 PDF；非 PDF 文档返回 false 即表示无需清理。
        await this.originalDocumentRepository.delete(kbId, docId);

        // 2.5) 清理 Soft Knowledge Graph 数据（workspace.sqlite）
        // 重要：必须在删除元数据之前完成，否则会残留“引用已删除 doc 的图谱边/进度”。
        const cleanup = await this.knowledgeGraphRepository.deleteGraphDataForDocument(kbId, docId);
        logger.info(
          `已清理文档图谱数据: kbId=${kbId}, docId=${docId}, ` +
            `deletedEdges=${cleanup.deletedEdges}, deletedDocStatus=${cleanup.deletedDocStatus}, deletedOrphanNodes=${cleanup.deletedOrphanNodes}`
        );

        // 3) 最后删除元数据记录（删除后系统应不再暴露该 docId）
        await this.metadataRepository.deleteDocument(docId);
      };

      if (hasCollectionAccessCoordinator(this.qdrantRepository)) {
        await this.qdrantRepository.runWithCollectionAccess(kbId, 'shared', executeDelete);
      } else {
        await executeDelete();
      }

      logger.info(`文档 ${docId} 已成功删除`);
    } catch (error) {
      logger.error(`删除文档 ${docId} 失败: ${error}`);
      throw error;
    }
  }

  /**
   * **功能 (What):** 根据ID获取单个文档的元数据。
   * **输入 (Input / @param):** 
   * @param docId - (string) 文档的ID。
   * **输出 (Output / @returns):** `Promise<Document | undefined>` - 文档对象或未找到则为undefined。
   * **副作用 (Side-effects):** 查询元数据仓储。
   */
  async getDocumentById(docId: string): Promise<Document | undefined> {
    logger.info(`正在获取文档元数据: ${docId}`);
    try {
      const document = await this.metadataRepository.getDocumentById(docId);
      if (document) {
        logger.info(`成功获取到文档元数据: ${document.filename}`);
      } else {
        logger.warn(`未找到ID为 ${docId} 的文档`);
      }
      return document;
    } catch (error) {
      logger.error(`获取文档 ${docId} 元数据失败: ${error}`);
      throw error;
    }
  }

  /**
   * **功能 (What):** 根据状态计算进度百分比
   * **输入 (Input):** 状态字符串
   * **输出 (Output):** 进度百分比 (0-100)
   * **副作用 (Side-effects):** 无
   */
  private calculateProgressFromStatus(status: string): number {
    switch (status) {
      case 'pending': return 0;
      case 'processing': return 50; // 默认50%，实际会被stage_progress覆盖
      case 'completed': 
      case 'duplicate': return 100;
      case 'failed': return 0;
      default: return 0;
    }
  }

  /**
   * **功能 (What):** 计算预估剩余时间
   * **输入 (Input):** 任务状态对象
   * **输出 (Output):** 预估剩余时间（秒）或undefined
   * **副作用 (Side-effects):** 无
   */
  private calculateEstimatedTimeRemaining(progressSnapshot: IngestionProgressSnapshot): number | undefined {
    // 简单的预估逻辑，可以根据实际需要扩展
    if (progressSnapshot.status === 'processing') {
      // 假设处理中的任务还需要60秒（简化实现）
      return 60;
    }
    return undefined;
  }

}
