/**
 * @file src/knowledge-base/ingestion/handlers/StoringHandler.ts
 * 
 * @brief STORING状态处理器
 * 
 * @description
 * 功能 (What): 处理数据存储阶段的业务逻辑
 * 输入 (Input): TaskContext包含向量化结果
 * 输出 (Output): StateTransitionResult，标记为COMPLETED状态
 * 副作用 (Side-effects): 保存SoT文件，存储向量到Qdrant，更新元数据
 */

import { Logger } from 'src/shared/logger';
import { InternalStage, type StateHandler, type StateTransitionResult, type TaskContext } from '../definitions/state';
import { promises as fs } from 'fs';
import { SotRepository } from '../../infrastructure/sotRepository';
import {
  QdrantRepository,
  QdrantPoint,
  PointPayload,
  VectorData,
  SparseVector
} from '../../infrastructure/qdrantRepository';
import { MetadataRepository } from '../../infrastructure/metadataRepository';
import { DocumentStatus } from '../../domain/document';
import { DocumentSoTSchema, type DocumentSoT } from '../../domain/block';
import { inspect } from 'util'; // 导入inspect
import type { VectorizedBlock, StoreResult } from '../ingestionTypes';
import { hasCollectionAccessCoordinator } from '../../infrastructure/qdrant-repository/collectionAccess';
import { resolveTargetSegmentCountByPointsCount } from '../../infrastructure/qdrant-repository/segmentPolicy';

const logger = new Logger('knowledge-base:ingestion:storing-handler');

/**
 * 功能 (What): STORING状态处理器 - 数据存储核心逻辑
 * 输入 (Input): 任务上下文，包含向量化结果
 * 输出 (Output): 转换到COMPLETED状态
 * 副作用 (Side-effects): 三阶段存储：SoT文件、向量数据库、元数据更新
 */
export class StoringHandler implements StateHandler {
  private readonly sotRepository: SotRepository;
  private readonly qdrantRepository: QdrantRepository;
  private readonly metadataRepository: MetadataRepository;

  constructor(
    sotRepository: SotRepository,
    qdrantRepository: QdrantRepository,
    metadataRepository: MetadataRepository
  ) {
    this.sotRepository = sotRepository;
    this.qdrantRepository = qdrantRepository;
    this.metadataRepository = metadataRepository;
  }
  
  getName(): string {
    return 'StoringHandler';
  }

  async execute(context: TaskContext): Promise<StateTransitionResult> {
    logger.info(`[StoringHandler] 开始存储数据: ${context.docId}`);

    try {
      // 验证向量化结果
      if (!context.vectorizeResult) {
        throw new Error('缺少向量化结果，无法进行存储');
      }

      const { vectorizedBlocks } = context.vectorizeResult;
      const vectorCount = vectorizedBlocks.length; // 🔥 缓存数量，便于后续释放内存
      logger.info(`[StoringHandler] 准备存储 ${vectorCount} 个向量化块`);
      
      // 初始化进度
      context.stageProgress = 0;

      await this.validateEmbeddingProvenanceForAppend(context);

      // 阶段 1: 保存 Source of Truth (SoT) 文件
      await this.saveSotFile(context);
      context.stageProgress = 25;
      
      // 阶段 2: 存储向量数据到 Qdrant
      await this.storeVectorDataWithCollectionAccess(context);
      context.stageProgress = 75;
      
      // 阶段 3: 更新元数据
      await this.updateMetadata(context);
      context.stageProgress = 95;
      
      // 阶段 4: 清理临时文件
      await this.cleanupTempFiles(context);
      context.stageProgress = 100;

      // 🔥 释放大内存对象的引用，降低后续内存占用
      if (context.vectorizeResult && Array.isArray(context.vectorizeResult.vectorizedBlocks)) {
        context.vectorizeResult.vectorizedBlocks.length = 0;
      }

      logger.info(`[StoringHandler] 数据存储完成: ${context.docId}`);

      const storeResult: StoreResult = {
        vectorCount: vectorCount,
        storageTimestamp: Date.now(),
        success: true
      };

      return {
        success: true,
        newStage: InternalStage.COMPLETED,
        context: { 
          ...context, 
          storeResult: {
            ...storeResult
          },
          stageProgress: 100,
          currentProgress: 100
        },
        message: `数据存储完成: ${vectorCount} 个向量`
      };

    } catch (error) {
      const errorMessage = `数据存储失败: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`[StoringHandler] ${errorMessage}`, error);
      
      // 存储失败时尝试清理已存储的数据
      await this.cleanupOnFailure(context);
      
      return {
        success: false,
        newStage: InternalStage.FAILED,
        context: { ...context, errorMessage },
        error: errorMessage
      };
    }
  }

  /**
   * 功能 (What): 保存 Source of Truth 文件
   * 输入 (Input): 任务上下文
   * 输出 (Output): 无
   * 副作用 (Side-effects): 按 `DocumentSoTSchema` 保存原始文档 JSON
   */
  private async saveSotFile(context: TaskContext): Promise<void> {
    logger.info(`[StoringHandler] 阶段1: 保存SoT文件 - ${context.docId}`);
    
    try {
      if (!context.parseResult?.sourceDoc) {
        throw new Error('缺少 post-processed sourceDoc，无法创建SoT文件');
      }
      
      // 🔥 重构：直接使用后处理器生成的sourceDoc，它已经是最终格式
      const sotDocument: DocumentSoT = context.parseResult.sourceDoc;

      /**
       * 关键一致性补全（根因修复）：
       * - SoT.metadata.file_size 是后续“孤儿元数据修复 / 重复文件检测”所需的关键字段；
       * - 历史上我们缺失该字段时，只能把修复后的 kb_documents.fileSize 写成 0，会破坏判重逻辑；
       * - 因此在 SoT 写入阶段，尽可能写入真实文件大小（摄入完成后临时文件会被清理）。
       */
      let fileSizeBytes: number | undefined;
      try {
        const stat = await fs.stat(context.filePath);
        if (typeof stat.size === 'number' && Number.isFinite(stat.size) && stat.size >= 0) {
          fileSizeBytes = stat.size;
        }
      } catch (e) {
        logger.warn(
          `[StoringHandler] 无法读取文件大小，将跳过写入 SoT.metadata.file_size: ${context.filePath} (${e instanceof Error ? e.message : String(e)})`
        );
      }
          
      // 补充摄入任务的元数据（与 DocumentSoTSchema.metadata 字段对齐）
      sotDocument.metadata = {
        ...sotDocument.metadata,
        source_file: context.filename, // 确保使用最新的文件名
        ...(typeof fileSizeBytes === 'number' ? { file_size: fileSizeBytes } : {}),
            ingestion_timestamp: Date.now(),
            task_id: context.taskId,
            vector_model: context.embeddingModelId,
            vision_model: context.visionModelId
        };

      // 保存到SoT仓储
      await this.sotRepository.save(context.docId, sotDocument);
      
      logger.info(`[StoringHandler] ✅ SoT文件保存成功: ${context.docId}`);
    } catch (error) {
      logger.error(`[StoringHandler] ❌ 保存SoT文件失败: ${context.docId} - ${error instanceof Error ? error.message : String(error)}`);
      throw error; // 抛出错误以终止流程
    }
  }

  /**
   * 🔥 移除：convertBlocksForSot 方法已被删除
   * 因为后处理器现在直接生成最终格式，不再需要此转换函数
   */

  /**
   * 功能 (What): 存储向量数据到 Qdrant
   * 输入 (Input): 任务上下文
   * 输出 (Output): 无
   * 副作用 (Side-effects): 按当前 `QdrantPoint` 合同分批写入向量数据
   */
  private async storeVectorData(context: TaskContext): Promise<void> {
    logger.info(`[StoringHandler] 阶段2: 存储向量数据 - ${context.docId}`);
    
    try {
      const vectorizedBlocks: VectorizedBlock[] = context.vectorizeResult?.vectorizedBlocks ?? [];
      if (vectorizedBlocks.length === 0) {
        logger.warn(`[StoringHandler] 无向量数据需要存储: ${context.docId}`);
        return;
      }

      // 🔥 重构：直接使用简洁的块结构构建Qdrant点
      const qdrantPoints: QdrantPoint[] = vectorizedBlocks.map((block) => {
        const pointId = block.id; // ✅ block.id 在后处理阶段已保证“稳定且唯一”
        
        // 关键：直接使用已标准化的字段
        const payload: PointPayload = {
          doc_id: context.docId,
          block_id: block.id,
          document: block.text,
          doc_title: context.filename, // 使用任务上下文中的文件名
          block_type: block.block_type,
          page_number: block.source_info?.page_num, // 使用新规范的 page_num
          para_idx: block.source_info?.para_idx,
          ...(typeof block.parent_block_id === 'string' ? { parent_block_id: block.parent_block_id } : {}),
          ...(typeof block.part_index === 'number' ? { part_index: block.part_index } : {}),
          // 保留原始的source_info作为元数据，以备将来使用
          metadata: {
            source_info: block.source_info
          }
        };

        const vectorData: VectorData = {
          default: block.vector
        };
        
          vectorData.bm25 = block.sparse_vector;

        return {
          id: pointId,
          vector: vectorData,
          payload: payload
        };
      });

      // ✅ 根因修复：向量必须写入“目标知识库对应的集合”，否则搜索会查错集合
      // - 搜索：SearchService 使用 kbId 作为 collectionName
      // - 写入：这里也必须与之对齐
      const collectionName = context.kbId;
      
      const vectorDimension = vectorizedBlocks[0]?.vector?.length || 768;
      await this.qdrantRepository.getOrCreateCollection(
        collectionName,
        vectorDimension,
        'Cosine',
        true,
        {
          // chunk collection 若首次创建，应直接带上小库目标段数，避免先按默认多段起步。
          defaultSegmentNumber: resolveTargetSegmentCountByPointsCount(0),
        }
      );

      // 分批存储到Qdrant
      const batchSize = 50;
      const totalPoints = qdrantPoints.length;
      
      logger.info(`[StoringHandler] 开始分批存储: ${totalPoints} 个点，批量大小: ${batchSize}`);

      for (let i = 0; i < totalPoints; i += batchSize) {
        const batch = qdrantPoints.slice(i, i + batchSize);
        await this.qdrantRepository.addPoints(collectionName, batch);
        
        const progress = Math.min(100, ((i + batch.length) / totalPoints) * 100);
        this.updateProgress(context, 50 + progress * 0.4, '存储向量数据');
        
        logger.info(`[StoringHandler] 批次 ${Math.floor(i / batchSize) + 1} 存储完成: ${batch.length} 个点`);
      }
      
      logger.info(`[StoringHandler] ✅ 向量数据存储成功: ${totalPoints} 个点`);
    } catch (error) {
      logger.error(`[StoringHandler] ❌ 存储向量数据失败: ${context.docId} - ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * 功能：在同一个 chunk collection 的 shared access 下完成整次写入。
   *
   * 说明：
   * - 这样启动维护若准备独占重建，会等待本次上传完整结束；
   * - 避免在多批次 upsert 中途被后台 recreate 插入，导致“scroll 漏点 / 部分回灌”。
   */
  private async storeVectorDataWithCollectionAccess(context: TaskContext): Promise<void> {
    const collectionName = context.kbId;
    if (!hasCollectionAccessCoordinator(this.qdrantRepository)) {
      await this.storeVectorData(context);
      return;
    }

    await this.qdrantRepository.runWithCollectionAccess(collectionName, 'shared', async () => {
      await this.storeVectorData(context);
    });
  }

  /**
   * 功能 (What): 更新元数据
   * 输入 (Input): 任务上下文
   * 输出 (Output): 无
   * 副作用 (Side-effects): 更新文档状态为COMPLETED，记录处理统计信息
   */
  private async updateMetadata(context: TaskContext): Promise<void> {
    logger.info(`[StoringHandler] 阶段3: 更新元数据 - ${context.docId}`);
    
    try {
      /**
       * 提交点校验（Phase 1）：
       * - 只有当 SoT 与 Qdrant 均可证明写入成功时，才允许推进 SQLite 状态到 completed
       * - 否则必须 fail-fast 交给状态机失败清理/重试，避免“completed 但无法 browse/search”的不一致
       */
      await this.validateCommitPoint(context);

      await this.ensureEmbeddingProvenance(context);

      if (context.parseResult?.metadata.parseDiagnostics) {
        const diagnosticsUpdated = await this.metadataRepository.updateDocumentParseDiagnostics(
          context.docId,
          context.parseResult.metadata.parseDiagnostics
        );
        if (!diagnosticsUpdated) {
          throw new Error(`解析诊断写入失败`);
        }
      }
      
      // 调用真实的元数据更新
      const success = await this.metadataRepository.updateDocumentStatus(
        context.docId,
        DocumentStatus.COMPLETED
      );
      
      if (!success) {
        logger.warn(`[StoringHandler] 元数据状态更新未生效(首次): ${context.docId}，准备重试...`);
        // 短暂退避后重试一次
        await new Promise(r => setTimeout(r, 200));
        const retryOk = await this.metadataRepository.updateDocumentStatus(
          context.docId,
          DocumentStatus.COMPLETED
        );
        if (!retryOk) {
          logger.error(`[StoringHandler] 元数据状态更新重试仍未生效: ${context.docId}`);
          // 再次读取确认当前库中的实际状态
          try {
            const probe = await this.metadataRepository.getDocumentById(context.docId);
            if (!probe) {
              logger.error(`[StoringHandler] 🔍 校验: 数据库不存在该文档: ${context.docId}`);
            } else {
              logger.error(`[StoringHandler] 🔍 校验: 文档当前状态依然为 ${probe.status}`);
            }
          } catch (probeError) {
            logger.error(
              `[StoringHandler] 校验元数据失败: ${probeError instanceof Error ? probeError.message : String(probeError)}`,
            );
          }
          // 中止流程，交由状态机失败处理，避免前端获得 completed 的错觉
          throw new Error(`元数据状态写入失败`);
        }
      }
      
      // 🔥 调试：立即查询更新后的文档状态
      try {
        const updatedDoc = await this.metadataRepository.getDocumentById(context.docId);
        if (updatedDoc) {
          logger.info(`[StoringHandler] 🔍 更新后文档状态验证: ${context.docId} -> status=${updatedDoc.status}`);
        } else {
          logger.error(`[StoringHandler] 🔍 文档未找到: ${context.docId}`);
        }
      } catch (debugError) {
        logger.error(`[StoringHandler] 🔍 状态验证失败: ${debugError}`);
      }
      
      logger.info(`[StoringHandler] 元数据更新完成: ${context.docId}`);
      
    } catch (error) {
      throw new Error(`元数据更新失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 写入前校验已有索引出身，避免在模型不一致时先写入 SoT/Qdrant 再依赖失败清理。
   * 首次写入的 provenance 仍在提交点之后记录，确保它代表“已成功落盘的向量事实”。
   */
  private async validateEmbeddingProvenanceForAppend(context: TaskContext): Promise<void> {
    const existing = await this.metadataRepository.getKnowledgeBaseEmbeddingProvenance(context.kbId);
    if (existing && existing !== context.embeddingModelId) {
      throw new Error(
        `知识库 ${context.kbId} 的索引用 ${existing} 构建，当前上传使用 ${context.embeddingModelId}。请清空并重新导入该知识库后再上传。`
      );
    }
  }

  /**
   * 维护 KB 向量索引的 embedding 出身事实。
   *
   * 这里必须是 write-once：
   * - 空 KB 首次成功写入向量时记录模型；
   * - 已有出身时只允许同模型追加；
   * - 不允许覆盖，否则会把“混合向量空间”伪装成一致状态，搜索侧 mismatch 闸门也会失效。
   */
  private async ensureEmbeddingProvenance(context: TaskContext): Promise<void> {
    const existing = await this.metadataRepository.getKnowledgeBaseEmbeddingProvenance(context.kbId);
    if (!existing) {
      await this.metadataRepository.setKnowledgeBaseEmbeddingProvenance(
        context.kbId,
        context.embeddingModelId
      );
      return;
    }

    if (existing !== context.embeddingModelId) {
      throw new Error(
        `知识库 ${context.kbId} 的索引用 ${existing} 构建，当前上传使用 ${context.embeddingModelId}。请清空并重新导入该知识库后再上传。`
      );
    }
  }

  /**
   * Phase 1：提交点校验
   * - SoT 可读且 schema 合法
   * - Qdrant 中该 docId 至少存在 1 个点
   */
  private async validateCommitPoint(context: TaskContext): Promise<void> {
    // 1) SoT 校验：必须存在且结构合法
    const sot = await this.sotRepository.get(context.docId);
    if (!sot) {
      throw new Error(`提交点校验失败：SoT 不存在 (docId=${context.docId})`);
    }
    const sotParsed = DocumentSoTSchema.safeParse(sot);
    if (!sotParsed.success) {
      throw new Error(`提交点校验失败：SoT schema 非法 (docId=${context.docId})`);
    }

    // 2) Qdrant 校验：必须至少 1 个点
    const count = await this.qdrantRepository.countPointsByDocId(context.kbId, context.docId);
    if (count <= 0) {
      throw new Error(`提交点校验失败：Qdrant 未写入点 (kbId=${context.kbId}, docId=${context.docId})`);
    }
  }

  /**
   * 功能 (What): 清理临时文件
   * 输入 (Input): 任务上下文
   * 输出 (Output): 无
   * 副作用 (Side-effects): 删除上传的临时文件
   */
  private async cleanupTempFiles(context: TaskContext): Promise<void> {
    logger.info(`[StoringHandler] 阶段4: 清理临时文件 - ${context.filePath}`);
    
    try {
      // 检查文件是否存在
      const fileExists = await this.fileExists(context.filePath);
      if (!fileExists) {
        logger.warn(`[StoringHandler] 临时文件已不存在: ${context.filePath}`);
        return;
      }

      // 删除临时文件
      await fs.unlink(context.filePath);
      logger.info(`[StoringHandler] 临时文件删除成功: ${context.filePath}`);
      
    } catch (error) {
      // 临时文件清理失败不应该影响主流程
      logger.warn(`[StoringHandler] 临时文件清理失败: ${context.filePath} - ${error}`);
    }
  }

  /**
   * 功能 (What): 失败时清理已存储的数据
   * 输入 (Input): 任务上下文
   * 输出 (Output): 无
   * 副作用 (Side-effects): 尝试删除部分存储的数据，避免数据不一致
   */
  private async cleanupOnFailure(context: TaskContext): Promise<void> {
    logger.warn(`[StoringHandler] 存储失败，开始清理数据: ${context.docId}`);
    
    try {
      // 清理可能已存储的向量数据
      try {
        // ✅ 根因修复：清理向量也必须使用对应知识库的集合名
        await this.qdrantRepository.deletePointsByDocId(context.kbId, context.docId);
        logger.info(`[StoringHandler] 成功清理Qdrant中的向量数据: ${context.docId}`);
      } catch (qdrantError) {
        logger.error(`[StoringHandler] 清理Qdrant向量数据失败: ${qdrantError}`);
      }
      
      // 清理SoT文件
      try {
        const deleted = await this.sotRepository.delete(context.docId);
        if (deleted) {
          logger.info(`[StoringHandler] 成功清理SoT文件: ${context.docId}`);
        } else {
          logger.warn(`[StoringHandler] SoT文件可能不存在或已被删除: ${context.docId}`);
        }
      } catch (sotError) {
        logger.error(`[StoringHandler] 清理SoT文件失败: ${sotError}`);
      }
      
      // 更新文档状态为失败
      try {
        await this.metadataRepository.updateDocumentStatus(
          context.docId,
          DocumentStatus.FAILED,
          '摄入过程中发生错误，已清理部分数据'
        );
      } catch (metaError) {
        logger.error(`[StoringHandler] 更新失败状态失败: ${metaError}`);
      }
      
      logger.info(`[StoringHandler] 失败清理完成: ${context.docId}`);
      
    } catch (cleanupError) {
      logger.error(`[StoringHandler] 失败清理也出错了: ${cleanupError}`);
      // 不抛出异常，因为主要错误更重要
    }
  }

  /**
   * 功能 (What): 检查文件是否存在
   * 输入 (Input): 文件路径
   * 输出 (Output): 文件是否存在的布尔值
   * 副作用 (Side-effects): 访问文件系统
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 功能 (What): 更新任务进度
   * 输入 (Input): 任务上下文，进度百分比，操作描述
   * 输出 (Output): 无
   * 副作用 (Side-effects): 更新context.stageProgress
   */
  private updateProgress(context: TaskContext, percentage: number, operation: string) {
    const newProgress = Math.min(100, Math.max(0, percentage));
    if (newProgress !== context.stageProgress) {
      context.stageProgress = newProgress;
      logger.debug(`[StoringHandler] 进度更新: ${operation} - ${newProgress}%`);
    }
  }
}
