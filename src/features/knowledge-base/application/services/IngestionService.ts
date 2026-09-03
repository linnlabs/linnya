/**
 * @file src/knowledge-base/application/services/IngestionService.ts
 * 
 * @brief 文档摄入服务 - 负责文档添加和摄入流程管理
 * 
 * @description
 * 功能 (What): 处理文档的添加操作，启动摄入状态机，管理摄入流程
 * 输入 (Input): 文档文件信息、知识库ID、模型配置等
 * 输出 (Output): 文档对象和任务ID
 * 副作用 (Side-effects): 创建文档元数据、启动后台摄入任务、发送IPC状态更新
 */

import { Logger } from 'src/shared/logger';
import path from 'path';
import { Document, DocumentStatus, createDocument } from '../../domain/document';
import { generateTaskId } from '@shared/utils/idUtils';
import { QueueManager } from '@task-queue/queues';
import { MetadataRepository } from '../../infrastructure/metadataRepository';
import type { OriginalDocumentRepository } from '../../infrastructure/originalDocumentRepository';
import {
  type IngestionTaskParams,
  type ProgressCallback,
} from '../../ingestion/IngestionStateMachineManager';
import type { StatusUpdatePublisher } from '../../ingestion/definitions/statusUpdate';
import type { StateTransitionResult } from '../../ingestion/definitions/state';

const logger = new Logger('IngestionService');

/**
 * 摄入服务依赖接口
 */
export interface IngestionServiceDeps {
  metadataRepository: MetadataRepository;
  originalDocumentRepository: OriginalDocumentRepository;
  statusUpdatePublisher?: StatusUpdatePublisher;
  createNonWorkerIngestionProcessor?: NonWorkerIngestionProcessorFactory;
}

export interface NonWorkerIngestionProcessor {
  processDocument(params: IngestionTaskParams): Promise<StateTransitionResult>;
}

export type NonWorkerIngestionProcessorFactory = (options: {
  progressCallback?: ProgressCallback;
  statusUpdatePublisher?: StatusUpdatePublisher;
}) => NonWorkerIngestionProcessor;

/**
 * 功能 (What): 文档摄入服务类，处理文档添加和摄入流程
 * 输入 (Input): 依赖注入的MetadataRepository
 * 输出 (Output): 文档摄入操作的业务逻辑封装
 * 副作用 (Side-effects): 协调文档创建、队列管理、状态机执行
 */
export class IngestionService {
  private readonly metadataRepository: MetadataRepository;
  private readonly originalDocumentRepository: OriginalDocumentRepository;
  private readonly statusUpdatePublisher?: StatusUpdatePublisher;
  private readonly createNonWorkerIngestionProcessor?: NonWorkerIngestionProcessorFactory;

  constructor(deps: IngestionServiceDeps) {
    this.metadataRepository = deps.metadataRepository;
    this.originalDocumentRepository = deps.originalDocumentRepository;
    this.statusUpdatePublisher = deps.statusUpdatePublisher;
    this.createNonWorkerIngestionProcessor = deps.createNonWorkerIngestionProcessor;
  }

  /**
   * **功能 (What):** 向知识库添加文档并启动处理流程。
   * 
   * **输入 (Input / @param):**
   * @param kbId - (string) 知识库的ID。
   * @param filePath - (string) 文档的本地文件路径。
   * @param fileName - (string) 文档的原始文件名。
   * @param fileSize - (number) 文件大小（字节）。
   * @param embeddingModelId - (string) 嵌入模型的ID。
   * @param pdfOcrModelId - (string, optional) PDF OCR 模型的ID。
   * @param imageVisionModelId - (string, optional) 图片视觉模型的ID。
   * @param rerankModelId - (string, optional) 重排序模型的ID。
   * @param forceVisionMode - (boolean, optional) 是否强制使用视觉模式解析PDF。
   * @param graphExtractionModelId - (string, optional) 新上传文档的图谱抽取模型快照。
   * 
   * **输出 (Output / @returns):** `Promise<{ taskId: string; document: Document; }>` - 返回任务ID和文档对象，所有状态更新通过状态机统一处理。
   * 
   * **副作用 (Side-effects):**
   * 1. 检查知识库是否存在。
   * 2. 在元数据仓储中创建新的文档记录（状态为PENDING）。
   * 3. 启动后台任务，由状态机统一处理所有状态转换（包括重复文件检测）。
   * 4. 状态更新通过状态机的监听器机制自动推送到前端。
   */
  async addDocument(
    kbId: string, 
    filePath: string, 
    fileName: string, 
    fileSize: number, 
    embeddingModelId: string,
    pdfOcrModelId?: string,
    imageVisionModelId?: string,
    rerankModelId?: string,
    forceVisionMode?: boolean,
    graphExtractionModelId?: string
  ): Promise<{ taskId: string; document: Document; }> {
    logger.info(`向知识库 ${kbId} 添加文档: ${fileName} (${fileSize} bytes)${forceVisionMode ? ' [强制视觉模式]' : ''}`);
    
    try {
      // 检查知识库是否存在
      const kb = await this.metadataRepository.getKnowledgeBaseById(kbId);
      if (!kb) {
        throw new Error(`知识库 ${kbId} 不存在`);
      }
      
      // 生成文档ID和任务ID
      const docId = generateTaskId(); // 临时使用taskId作为docId，后续可以改为基于文件内容的确定性ID
      const taskId = generateTaskId();
      
      // 🔥 重构修复：移除重复文件检测，改为在状态机中统一处理
      // 重复文件检测现在由PendingHandler负责，确保所有状态变化都通过状态机
      
      // 创建新文档记录（始终创建，重复检测由状态机处理）
      const document = createDocument(
        docId,
        kbId,
        fileName,
        fileSize
      );

      const shouldPersistOriginalPdf = path.extname(fileName).toLowerCase() === '.pdf';
      if (shouldPersistOriginalPdf) {
        await this.originalDocumentRepository.save({
          kbId,
          docId,
          sourcePath: filePath,
          originalFilename: fileName,
        });
        logger.info(`原始 PDF 已持久化: docId=${docId}`);
      }

      try {
        await this.metadataRepository.addDocument(document);
      } catch (error) {
        if (shouldPersistOriginalPdf) {
          await this.originalDocumentRepository.delete(kbId, docId);
        }
        throw error;
      }
      logger.info(`文档记录已创建: ${docId}`);
      
      // 异步启动摄入流程，不等待完成
      this.processDocumentInBackground(
        filePath,
        docId,
        kbId,
        taskId,
        embeddingModelId,
        fileName,
        pdfOcrModelId,
        imageVisionModelId,
        rerankModelId,
        forceVisionMode, // 🔥 新增：传递强制视觉模式参数
        graphExtractionModelId
      ).catch(error => {
        logger.error(`后台摄入流程启动失败: ${error}`);
      });
      
      logger.info(`文档添加完成，任务ID: ${taskId}`);
      return { taskId, document };
      
    } catch (error) {
      logger.error(`添加文档失败: ${error}`);
      throw error;
    }
  }

  /**
   * **功能 (What):** 在后台异步处理文档的摄入流程，包括解析、嵌入和存储。
   * 
   * **输入 (Input / @param):**
   * @param filePath - (string) 文档的本地文件路径。
   * @param docId - (string) 文档的唯一ID。
   * @param kbId - (string) 所属知识库的ID。
   * @param taskId - (string) 本次处理任务的ID。
   * @param embeddingModelId - (string) 嵌入模型的ID。
   * @param originalFileName - (string) 原始文件名。
   * @param pdfOcrModelId - (string, optional) PDF OCR 模型的ID。
   * @param imageVisionModelId - (string, optional) 图片视觉模型的ID。
   * @param rerankModelId - (string, optional) 重排序模型的ID。
   * @param forceVisionMode - (boolean, optional) 是否强制使用视觉模式解析PDF。
   * @param graphExtractionModelId - (string, optional) 新上传文档的图谱抽取模型快照。
   * 
   * **输出 (Output / @returns):** `Promise<void>`
   * 
   * **副作用 (Side-effects):**
   * 1. 使用状态机管理器处理文档摄入流程。
   * 2. 在处理开始、成功或失败时，更新元数据仓储中文档的状态。
   * 3. 通过IPC向前端推送实时状态更新。
   */
  private async processDocumentInBackground(
    filePath: string,
    docId: string,
    kbId: string,
    taskId: string,
    embeddingModelId: string,
    originalFileName: string,
    pdfOcrModelId?: string,
    imageVisionModelId?: string,
    rerankModelId?: string,
    forceVisionMode?: boolean,
    graphExtractionModelId?: string
  ): Promise<void> {
    logger.info(`🚀 开始后台处理文档: ${originalFileName} (docId: ${docId}, taskId: ${taskId})`);
    
    // 将任务推入队列管理器
    try {
      const queueManager = QueueManager.getInstance();
      
      const jobPayload = {
        taskId,
        docId,
        kbId,
        filename: originalFileName,
        filePath,
        embeddingModelId,
        pdfOcrModelId,
        imageVisionModelId,
        // 兼容旧字段：供尚未迁移完成的调用链观察/排查
        visionModelId: imageVisionModelId,
        rerankModelId,
        graphExtractionModelId,
        priority: 1,
        retry: true,
        forceVisionMode: forceVisionMode ?? false // 🔥 新增：传递强制视觉模式参数，确保非undefined
      };
      
      await queueManager.addIngestionTask(jobPayload);
      logger.info(`📋 文档摄入任务已添加到队列(Worker模式): ${taskId}`);
      
    } catch (queueError) {
      logger.warn(`📋 队列系统不可用或未初始化，切入非Worker同步模式: ${taskId}. 错误: ${queueError instanceof Error ? queueError.message : String(queueError)}`);
      
      // 如果队列添加失败，尝试直接使用状态机处理（同步处理模式）
      logger.info(`🔄 切换到同步处理模式(Non-Worker): ${taskId}`);
      
      try {
        if (!this.createNonWorkerIngestionProcessor) {
          throw new Error('缺少 Non-Worker 摄入状态机依赖，无法从队列模式切换为同步处理');
        }

        // 使用传入的原始文件名（包含正确的扩展名）
        const filename = originalFileName;
        
        // 创建状态机管理器实例，传递共享的repository实例
        const manager = this.createNonWorkerIngestionProcessor({
          progressCallback: (stage, progress, message, error) => {
            logger.info(`📊(Non-Worker) 文档处理进度: ${stage} (${progress}%) - ${message}`);
            if (error) {
              logger.error(`❌(Non-Worker) 处理错误: ${error}`);
            }
          },
          statusUpdatePublisher: this.statusUpdatePublisher,
        });
        
        logger.info(`🔄(Non-Worker) 启动状态机流程...`);
        
        // 使用状态机管理器处理文档
        const result = await manager.processDocument({
          taskId,
          docId,
          kbId,
          filename,
          filePath,
          embeddingModelId,
          pdfOcrModelId,
          imageVisionModelId,
          visionModelId: imageVisionModelId,
          rerankModelId,
          graphExtractionModelId,
          forceVisionMode // 🔥 新增：传递强制视觉模式参数
        });
        
        // 处理状态机执行结果
        if (result.success) {
          logger.info(`✅(Non-Worker) 状态机处理成功: ${docId}, 最终状态: ${result.newStage}`);
        } else {
          logger.error(`💥(Non-Worker) 状态机处理失败: ${docId}, 错误: ${result.error}`);
          // 确保失败状态被正确记录
          await this.metadataRepository.updateDocumentStatus(
            docId, 
            DocumentStatus.FAILED, 
            result.error || '状态机处理失败'
          );
        }
        
      } catch (error) {
        const errorMessage = `状态机系统异常(Non-Worker): ${error instanceof Error ? error.message : String(error)}`;
        logger.error(`💥(Non-Worker) 状态机系统级错误 ${docId}: ${errorMessage}`, error);
        
        // 更新文档状态为失败
        await this.metadataRepository.updateDocumentStatus(
          docId, 
          DocumentStatus.FAILED, 
          errorMessage
        );
      }
    }
  }

  // 🔥 重构修复：移除直接IPC推送方法
  // 所有状态更新现在通过状态机的监听器机制统一处理
}
