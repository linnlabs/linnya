/**
 * @file src/knowledge-base/ingestion/handlers/PendingHandler.ts
 * 
 * @brief PENDING状态处理器
 * 
 * @description
 * 功能 (What): 处理任务的初始PENDING状态
 * 输入 (Input): TaskContext
 * 输出 (Output): StateTransitionResult，决定下一步是解析还是标记为重复
 * 副作用 (Side-effects): 检查重复文件，验证输入参数
 */

import { Logger } from 'src/shared/logger';
import {
  InternalStage,
  type StateHandler,
  type StateTransitionResult,
  type TaskContext,
} from '../definitions/state';
import { promises as fs } from 'fs';
import { MetadataRepository } from '../../infrastructure/metadataRepository';
import { cleanupFailedDocument as globalCleanupFailedDocument } from '../failureCleanup';

const logger = new Logger('PendingHandler');

/**
 * 功能 (What): PENDING状态处理器 - 验证文件和检测重复
 * 输入 (Input): 任务上下文
 * 输出 (Output): 状态转换结果
 * 副作用 (Side-effects): 文件系统检查、重复文件检测、参数验证
 */
export class PendingHandler implements StateHandler {
  private readonly metadataRepository?: MetadataRepository;

  constructor(metadataRepository?: MetadataRepository) {
    this.metadataRepository = metadataRepository;
    // 🔥 调试：记录MetadataRepository注入状态
    console.log(`[PendingHandler] 构造函数: MetadataRepository ${metadataRepository ? '已注入' : '未注入'}`);
    if (metadataRepository) {
      console.log(`[PendingHandler] MetadataRepository类型:`, metadataRepository.constructor.name);
    }
  }
  
  getName(): string {
    return 'PendingHandler';
  }

  async execute(context: TaskContext): Promise<StateTransitionResult> {
    logger.info(`[PendingHandler] 开始处理PENDING状态: ${context.docId}`);

    try {
      // 步骤 1: 验证必要参数
      const validationResult = this.validateInputs(context);
      if (!validationResult.isValid) {
        return {
          success: false,
          newStage: InternalStage.FAILED,
          context: { ...context, errorMessage: validationResult.error },
          error: validationResult.error
        };
      }

      // 步骤 2: 检查文件是否存在
      const fileExists = await this.checkFileExists(context.filePath);
      if (!fileExists) {
        const error = `文件不存在: ${context.filePath}`;
        logger.error(`[PendingHandler] ${error}`);
        return {
          success: false,
          newStage: InternalStage.FAILED,
          context: { ...context, errorMessage: error },
          error
        };
      }

      const provenanceValidation = await this.validateEmbeddingProvenance(context);
      if (!provenanceValidation.isValid) {
        return {
          success: false,
          newStage: InternalStage.FAILED,
          context: { ...context, errorMessage: provenanceValidation.error },
          error: provenanceValidation.error
        };
      }

      // 🔥 重构修复：步骤3 - 检查是否为重复文件（从IngestionService迁移过来）
      const isDuplicate = await this.checkDuplicateDocumentInKnowledgeBase(context);
      if (isDuplicate) {
        logger.info(`[PendingHandler] 检测到重复文件: ${context.filename} (知识库: ${context.kbId})`);
        return {
          success: true,
          newStage: InternalStage.DUPLICATE,
          context: { 
            ...context, 
            stageProgress: 100,
            currentProgress: 100 
          },
          message: '检测到重复文件，跳过处理'
        };
      }

      // 步骤 4: 准备开始解析
      logger.info(`[PendingHandler] 验证通过，准备开始解析: ${context.docId}`);
      return {
        success: true,
        newStage: InternalStage.PARSING,
        context: { 
          ...context, 
          stageProgress: 0,
          currentProgress: 5  // PENDING完成，整体进度5%
        },
        message: '开始解析文档'
      };

    } catch (error) {
      const errorMessage = `PENDING状态处理失败: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`[PendingHandler] ${errorMessage}`, error);
      
      return {
        success: false,
        newStage: InternalStage.FAILED,
        context: { ...context, errorMessage },
        error: errorMessage
      };
    }
  }

  /**
   * 功能 (What): 验证输入参数
   * 输入 (Input): 任务上下文
   * 输出 (Output): 验证结果对象
   * 副作用 (Side-effects): 无
   */
  private validateInputs(context: TaskContext): { isValid: boolean; error?: string } {
    if (!context.taskId) {
      return { isValid: false, error: '缺少任务ID' };
    }

    if (!context.docId) {
      return { isValid: false, error: '缺少文档ID' };
    }

    if (!context.kbId) {
      return { isValid: false, error: '缺少知识库ID' };
    }

    if (!context.filename) {
      return { isValid: false, error: '缺少文件名' };
    }

    if (!context.filePath) {
      return { isValid: false, error: '缺少文件路径' };
    }

    if (!context.embeddingModelId) {
      return { isValid: false, error: '缺少向量化模型ID' };
    }

    return { isValid: true };
  }

  /**
   * 功能 (What): 检查文件是否存在
   * 输入 (Input): 文件路径
   * 输出 (Output): 文件是否存在的布尔值
   * 副作用 (Side-effects): 访问文件系统
   */
  private async checkFileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 校验本次上传使用的 embedding 模型是否与知识库已有索引出身一致。
   *
   * 关键约束：
   * - `embedding_model_id` 在 KB 表里表示“已落盘向量的模型出身”，不是用户偏好；
   * - 一旦 KB 已有向量索引，继续追加文档必须使用同一模型；
   * - 换 embedding 模型前必须清空/重建该 KB，避免同一 collection 混入不同向量空间。
   */
  private async validateEmbeddingProvenance(context: TaskContext): Promise<{ isValid: boolean; error?: string }> {
    if (!this.metadataRepository) {
      logger.warn(`[PendingHandler] MetadataRepository未注入，跳过索引出身校验`);
      return { isValid: true };
    }

    const existing = await this.metadataRepository.getKnowledgeBaseEmbeddingProvenance(context.kbId);
    if (!existing || existing === context.embeddingModelId) {
      return { isValid: true };
    }

    const error = `知识库 ${context.kbId} 的索引用 ${existing} 构建，当前全局嵌入模型是 ${context.embeddingModelId}。请清空并重新导入该知识库后再上传。`;
    logger.warn(`[PendingHandler] ${error}`);
    return { isValid: false, error };
  }

  /**
   * 🔥 重构修复：功能 (What): 检查知识库中是否存在重复文档（从IngestionService迁移）
   * 输入 (Input): 任务上下文
   * 输出 (Output): 是否为重复文档的布尔值
   * 副作用 (Side-effects): 查询元数据仓储
   */
  private async checkDuplicateDocumentInKnowledgeBase(context: TaskContext): Promise<boolean> {
    try {
      // 如果没有注入MetadataRepository，跳过重复检测
      if (!this.metadataRepository) {
        logger.warn(`[PendingHandler] MetadataRepository未注入，跳过重复文件检测`);
        return false;
      }
      
      // 获取文件信息进行重复检测
      const stats = await fs.stat(context.filePath);
      const fileSize = stats.size;
      const fileName = context.filename;
      
      logger.info(`[PendingHandler] 🔍 开始重复文件检测: ${fileName} (${fileSize} bytes) in KB: ${context.kbId}`);
      
      // 🔥 重构修复：实现真正的重复文件检测（从IngestionService迁移过来的逻辑）
      const existingDocs = await this.metadataRepository.getDocumentsInKnowledgeBase(context.kbId);
      logger.info(`[PendingHandler] 📋 知识库中共有 ${existingDocs.length} 个文档`);
      
      // 🔥 关键修复：排除当前文档本身，只检查其他已存在的文档
      // 🔥 新增修复：排除FAILED状态的文档，允许重试失败的文件
      const otherDocs = existingDocs.filter(doc => 
        doc.id !== context.docId && doc.status !== 'failed'
      );
      
      logger.info(`[PendingHandler] 📋 排除当前文档和失败文档后，剩余 ${otherDocs.length} 个文档待比较`);
      
      // 首先检查是否有成功或处理中的重复文档
      const duplicateDoc = otherDocs.find(doc => 
        doc.filename === fileName && doc.fileSize === fileSize
      );
      
      if (duplicateDoc) {
        logger.info(`[PendingHandler] ⚠️ 发现重复文档:`);
        logger.info(`[PendingHandler]   - 当前文件: ${fileName} (${fileSize} bytes)`);
        logger.info(`[PendingHandler]   - 重复文档: ${duplicateDoc.filename} (${duplicateDoc.fileSize} bytes, status: ${duplicateDoc.status}, id: ${duplicateDoc.id})`);
      } else {
        logger.info(`[PendingHandler] ✅ 未发现重复文档，文件可以处理`);
      }
      
      const isDuplicate = !!duplicateDoc;
      
      // 🔥 新增：检查是否有失败的同名文件，如果有则清理它们
      const failedDuplicates = existingDocs.filter(doc => 
        doc.id !== context.docId && 
        doc.status === 'failed' && 
        doc.filename === fileName && 
        doc.fileSize === fileSize
      );

      if (failedDuplicates.length > 0) {
        logger.info(`[PendingHandler] 发现 ${failedDuplicates.length} 个失败的同名文件，将清理它们`);
        for (const failedDoc of failedDuplicates) {
          try {
            await this.metadataRepository.deleteDocument(failedDoc.id);
            logger.info(`[PendingHandler] ✅ 已清理失败的重复文档: ${failedDoc.id}`);
          } catch (cleanupError) {
            logger.error(`[PendingHandler] ❌ 清理失败文档时出错: ${cleanupError}`);
          }
        }
      }

      if (isDuplicate) {
        logger.info(`[PendingHandler] 发现重复文档: ${fileName} (已存在文档ID: ${duplicateDoc?.id})`);
        
        // 🔥 重要修复：删除新创建的重复文档记录，保留原有的文档
        try {
          await this.metadataRepository.deleteDocument(context.docId);
          logger.info(`[PendingHandler] 已删除新创建的重复文档记录: ${context.docId}`);
          logger.info(`[PendingHandler] 保留原有文档: ${duplicateDoc?.id} (${duplicateDoc?.filename})`);
        } catch (deleteError) {
          logger.error(`[PendingHandler] 删除新创建的重复文档记录失败: ${deleteError}`);
        }
        
        return true;
      }
      
      logger.debug(`[PendingHandler] 未发现重复文件，继续处理: ${fileName}`);
      return false;
      
    } catch (error) {
      logger.error(`[PendingHandler] 重复文件检测失败: ${error}`);
      // 检测失败时，继续处理（假设不重复）
      return false;
    }
  }

  /**
   * 功能 (What): 清理失败的文档数据
   * 输入 (Input): 失败文档的ID
   * 输出 (Output): 无
   * 副作用 (Side-effects): 删除三大数据源，允许重试
   */
  private async cleanupFailedDocument(docId: string): Promise<void> {
    // 使用统一的清理函数，在PendingHandler阶段通常只会清理SQLite
    // 因为还没有Qdrant和SOT数据，清理函数会安全跳过
    await globalCleanupFailedDocument(docId, '', this.metadataRepository);
  }

  /**
   * 功能 (What): 检查是否为重复文档（原有方法，保持兼容）
   * 输入 (Input): 任务上下文
   * 输出 (Output): 是否为重复文档的布尔值
   * 副作用 (Side-effects): 文件系统检查
   */
  private async checkDuplicateDocument(context: TaskContext): Promise<boolean> {
    // 🔥 重构：这个方法现在被checkDuplicateDocumentInKnowledgeBase替代
    // 保留是为了向后兼容，实际逻辑已迁移
    return this.checkDuplicateDocumentInKnowledgeBase(context);
  }
}
