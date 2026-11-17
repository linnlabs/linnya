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
import type { SotRepository } from '../../infrastructure/sotRepository';
import { RETAINED_SOURCE_DUPLICATE_MESSAGE } from '../definitions/stateMapping';

const logger = new Logger('PendingHandler');

/**
 * 功能 (What): PENDING状态处理器 - 验证文件和检测重复
 * 输入 (Input): 任务上下文
 * 输出 (Output): 状态转换结果
 * 副作用 (Side-effects): 文件系统检查、重复文件检测、参数验证
 */
export class PendingHandler implements StateHandler {
  constructor(private readonly metadataRepository: MetadataRepository, private readonly sotRepository: Pick<SotRepository, 'get'>) {}
  
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
          message: context.duplicateReason === 'retained_source' ? RETAINED_SOURCE_DUPLICATE_MESSAGE : '检测到重复文件，跳过处理'
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
   * - 一旦 KB 已有向量索引，继续追加文档必须使用同一向量空间；
   * - 更换向量空间前必须显式重建该 KB，避免同一 collection 混入不同向量空间。
   */
  private async validateEmbeddingProvenance(context: TaskContext): Promise<{ isValid: boolean; error?: string }> {
    const state = this.metadataRepository.indexState.read(context.kbId);
    if (state.spaceId) context.embeddingSpaceId = state.spaceId;
    else {
      const documents = await this.metadataRepository.getDocumentsInKnowledgeBase(context.kbId);
      if (documents.some(document => document.status === 'completed')) {
        return { isValid: false, error: '检索索引来源未知，请先重建检索索引；原文仍可阅读。' };
      }
    }
    return { isValid: true };
  }

  /**
   * 🔥 重构修复：功能 (What): 检查知识库中是否存在重复文档（从IngestionService迁移）
   * 输入 (Input): 任务上下文
   * 输出 (Output): 是否为重复文档的布尔值
   * 副作用 (Side-effects): 查询元数据仓储
   */
  private async checkDuplicateDocumentInKnowledgeBase(context: TaskContext): Promise<boolean> {
    try {
      // 获取文件信息进行重复检测
      const stats = await fs.stat(context.filePath);
      const fileSize = stats.size;
      const fileName = context.filename;
      
      logger.info(`[PendingHandler] 🔍 开始重复文件检测: ${fileName} (${fileSize} bytes) in KB: ${context.kbId}`);
      
      // 🔥 重构修复：实现真正的重复文件检测（从IngestionService迁移过来的逻辑）
      const existingDocs = await this.metadataRepository.getDocumentsInKnowledgeBase(context.kbId);
      logger.info(`[PendingHandler] 📋 知识库中共有 ${existingDocs.length} 个文档`);
      
      const candidates = existingDocs.filter(doc => doc.id !== context.docId && doc.filename === fileName && doc.fileSize === fileSize);
      let duplicateDoc = candidates.find(doc => doc.status !== 'failed');
      if (!duplicateDoc) {
        // 已保存正文的失败资料只需重建索引；重传不能另建一份内容后被同时检索。
        for (const candidate of candidates) {
          if (await this.sotRepository.get(candidate.id)) {
            duplicateDoc = candidate;
            context.duplicateReason = 'retained_source';
            break;
          }
        }
      }

      if (duplicateDoc) {
        logger.info(`[PendingHandler] ⚠️ 发现重复文档:`);
        logger.info(`[PendingHandler]   - 当前文件: ${fileName} (${fileSize} bytes)`);
        logger.info(`[PendingHandler]   - 重复文档: ${duplicateDoc.filename} (${duplicateDoc.fileSize} bytes, status: ${duplicateDoc.status}, id: ${duplicateDoc.id})`);
      } else {
        logger.info(`[PendingHandler] ✅ 未发现重复文档，文件可以处理`);
      }
      
      const isDuplicate = !!duplicateDoc;
      
      // 失败不代表没有资料：向量写入失败可能已保留 SoT/原始 PDF。
      // 再次上传只负责新任务，不能在它成功前删除旧文档身份与用户的恢复入口。
      // 旧失败记录由显式删除或已有无源维护规则处理，不在重复检测中清理。

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
      // 无法确认来源时不能继续导入第二份，交由现有失败状态提供重试。
      throw error;
    }
  }

}
