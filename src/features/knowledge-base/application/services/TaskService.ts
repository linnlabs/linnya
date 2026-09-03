/**
 * @file src/knowledge-base/application/services/TaskService.ts
 * 
 * @brief 任务控制服务 - 负责任务的生命周期管理
 * 
 * @description
 * 功能 (What): 处理任务的取消、暂停、恢复等控制操作
 * 输入 (Input): 任务ID和控制指令
 * 输出 (Output): 操作结果和状态更新
 * 副作用 (Side-effects): 与队列管理器交互，控制Worker线程行为
 */

import { Logger } from 'src/shared/logger';
import { QueueManager } from '@task-queue/queues';
import { ServiceRegistry } from 'src/core/di/ServiceRegistry';
import { MetadataRepository } from '../../infrastructure/metadataRepository';
import { DocumentStatus } from '../../domain/document';

const logger = new Logger('TaskService');

export interface TaskServiceDeps {
  metadataRepository: MetadataRepository;
}

/**
 * 功能 (What): 任务控制服务类，处理任务生命周期管理
 * 输入 (Input): 任务ID和控制指令
 * 输出 (Output): 任务控制操作的业务逻辑封装
 * 副作用 (Side-effects): 与队列管理器通信，影响Worker线程执行状态
 */
export class TaskService {
  private readonly metadataRepository: MetadataRepository;

  constructor(deps: TaskServiceDeps) {
    this.metadataRepository = deps.metadataRepository;
  }

  private getKnowledgeGraphQueueOrchestrator():
    | import('../../graph/application/knowledgeGraphQueueOrchestrator').KnowledgeGraphQueueOrchestrator
    | null {
    try {
      const registry = ServiceRegistry.getInstance();
      const svc = registry.get('knowledgeGraphQueueOrchestrator') as unknown;
      return svc as import('../../graph/application/knowledgeGraphQueueOrchestrator').KnowledgeGraphQueueOrchestrator;
    } catch {
      return null;
    }
  }

  /**
   * **功能 (What):** 删除文档前取消所有后台任务（摄入 + 图谱抽取）
   * **输入 (Input):** kbId, docId
   * **输出 (Output):** Promise<void>
   * **副作用 (Side-effects):** 向队列发送取消信号（不保证立即停止，但能显著降低“删除后仍写回”的窗口）
   *
   * 说明：
   * - 这里不更新元数据状态（文档即将被删除），避免无意义的 failed 写回；
   * - cancellation 是 best-effort：队列未初始化/任务已结束都不视为错误。
   */
  async cancelTasksForDocumentDeletion(kbId: string, docId: string): Promise<void> {
    const queueManager = QueueManager.getInstance();

    // 1) 取消摄入任务（taskId 通常等于 docId）
    try {
      await queueManager.cancelIngestionTask(docId);
    } catch (e) {
      logger.warn(`删除文档前取消摄入任务失败（将继续删除流程）: docId=${docId}`, e as Error);
    }

    // 2) 取消图谱抽取任务（taskId != docId，需按 payload 过滤）
    try {
      const kgOrchestrator = this.getKnowledgeGraphQueueOrchestrator();
      const cancelled = kgOrchestrator ? await kgOrchestrator.cancelGraphExtractionTasksByDoc(kbId, docId) : 0;
      if (cancelled > 0) {
        logger.info(`删除文档前已取消图谱抽取任务: kbId=${kbId}, docId=${docId}, count=${cancelled}`);
      }
    } catch (e) {
      logger.warn(`删除文档前取消图谱抽取任务失败（将继续删除流程）: kbId=${kbId}, docId=${docId}`, e as Error);
    }

    // 3) 取消图谱索引任务（图谱向量化）
    try {
      const kgOrchestrator = this.getKnowledgeGraphQueueOrchestrator();
      const cancelled = kgOrchestrator ? await kgOrchestrator.cancelGraphIndexingTasksByDoc(kbId, docId) : 0;
      if (cancelled > 0) {
        logger.info(`删除文档前已取消图谱索引任务: kbId=${kbId}, docId=${docId}, count=${cancelled}`);
      }
    } catch (e) {
      logger.warn(`删除文档前取消图谱索引任务失败（将继续删除流程）: kbId=${kbId}, docId=${docId}`, e as Error);
    }
  }

  /**
   * **功能 (What):** 删除知识库前取消该 KB 下所有后台任务（摄入 + 图谱抽取）
   * **输入 (Input):** kbId, docIds（该 kb 下所有文档）
   * **输出 (Output):** Promise<void>
   * **副作用 (Side-effects):** 向队列发送取消信号
   */
  async cancelTasksForKnowledgeBaseDeletion(kbId: string, docIds: string[]): Promise<void> {
    const queueManager = QueueManager.getInstance();

    // 1) 取消图谱抽取（按 kbId 批量取消）
    try {
      const kgOrchestrator = this.getKnowledgeGraphQueueOrchestrator();
      const cancelled = kgOrchestrator ? await kgOrchestrator.cancelGraphExtractionTasksByKb(kbId) : 0;
      if (cancelled > 0) {
        logger.info(`删除知识库前已取消图谱抽取任务: kbId=${kbId}, count=${cancelled}`);
      }
    } catch (e) {
      logger.warn(`删除知识库前取消图谱抽取任务失败（将继续删除流程）: kbId=${kbId}`, e as Error);
    }

    // 1.5) 取消图谱索引（按 kbId 批量取消）
    try {
      const kgOrchestrator = this.getKnowledgeGraphQueueOrchestrator();
      const cancelled = kgOrchestrator ? await kgOrchestrator.cancelGraphIndexingTasksByKb(kbId) : 0;
      if (cancelled > 0) {
        logger.info(`删除知识库前已取消图谱索引任务: kbId=${kbId}, count=${cancelled}`);
      }
    } catch (e) {
      logger.warn(`删除知识库前取消图谱索引任务失败（将继续删除流程）: kbId=${kbId}`, e as Error);
    }

    // 2) 取消该 KB 下可能仍在运行的摄入任务（逐 docId best-effort）
    for (const docId of docIds) {
      try {
        await queueManager.cancelIngestionTask(docId);
      } catch (e) {
        logger.debug(`删除知识库前取消摄入任务失败（忽略）: docId=${docId}`, e as Error);
      }
    }
  }

  /**
   * **功能 (What):** 主动刷新 KB 级图谱进度（用于删除/取消后立即推送）
   * **输入 (Input):** kbId
   * **输出 (Output):** Promise<void>
   * **副作用 (Side-effects):** 触发 IPC 推送（节流）
   */
  async refreshKbGraphProgress(kbId: string): Promise<void> {
    try {
      const kgOrchestrator = this.getKnowledgeGraphQueueOrchestrator();
      kgOrchestrator?.refreshKbGraphProgress(kbId);
    } catch (e) {
      logger.debug(`刷新 KB 图谱进度失败（忽略）: kbId=${kbId}`, e as Error);
    }
  }

  /**
   * **功能 (What):** 取消指定的任务
   * **输入 (Input):** 任务ID（通常是docId）
   * **输出 (Output):** Promise<void>
   * **副作用 (Side-effects):** 
   * 1. 向Worker发送取消信号，中断正在执行的处理流程
   * 2. 从队列中移除待处理的任务
   * 3. 同步更新 SQLite 中文档状态为 failed（"用户取消"），避免后续重试被判为重复
   */
  async cancelTask(taskId: string): Promise<void> {
    logger.info(`取消任务: ${taskId}`);
    
    try {
      const queueManager = QueueManager.getInstance();
      // 在取消前尝试获取任务数据以拿到 docId
      const task = queueManager.getTaskById(taskId);
      const docId = task?.data.docId;

      const success = await queueManager.cancelIngestionTask(taskId);
      
      if (success) {
        logger.info(`任务 ${taskId} 取消请求已发送到队列管理器`);
        // 同步更新元数据状态为 failed，避免后续被判为 duplicate
        if (docId) {
          try {
            const ok = await this.metadataRepository.updateDocumentStatus(docId, DocumentStatus.FAILED, '用户取消');
            if (ok) {
              logger.info(`取消后已将文档 ${docId} 标记为 failed(用户取消)`);
            } else {
              logger.warn(`取消后未能标记文档 ${docId} 为 failed（可能不存在）`);
            }
          } catch (e) {
            logger.warn(`取消后更新文档状态失败: ${docId}`, e as Error);
          }
        } else {
          logger.warn(`未能在取消前获取到 docId，跳过元数据状态更新: taskId=${taskId}`);
        }
      } else {
        logger.info(`任务 ${taskId} 取消失败，可能任务不存在或已完成`);
      }
      
    } catch (error) {
      logger.error(`取消任务 ${taskId} 失败: ${error}`);
      throw error;
    }
  }

  /**
   * **功能 (What):** 暂停指定的任务
   * **输入 (Input):** 任务ID（通常是docId）
   * **输出 (Output):** Promise<void>
   * **副作用 (Side-effects):** 
   * 向 Worker 发送暂停信号，Worker 回报失败事件后由队列保留可恢复状态
   */
  async pauseTask(taskId: string): Promise<void> {
    logger.info(`暂停任务: ${taskId}`);
    
    try {
      const queueManager = QueueManager.getInstance();
      const success = await queueManager.pauseIngestionTask(taskId);
      
      if (success) {
        logger.info(`任务 ${taskId} 暂停请求已发送到队列管理器`);
      } else {
        logger.info(`任务 ${taskId} 暂停失败，可能任务不存在或不在运行状态`);
      }
      
    } catch (error) {
      logger.error(`暂停任务 ${taskId} 失败: ${error}`);
      throw error;
    }
  }

  /**
   * **功能 (What):** 恢复指定的任务
   * **输入 (Input):** 任务ID（通常是docId）
   * **输出 (Output):** Promise<void>
   * **副作用 (Side-effects):** 
   * 将已暂停的 Worker job 重新标记为待处理并启动队列调度
   */
  async resumeTask(taskId: string): Promise<void> {
    logger.info(`恢复任务: ${taskId}`);
    
    try {
      const queueManager = QueueManager.getInstance();
      const success = await queueManager.resumeIngestionTask(taskId);
      
      if (success) {
        logger.info(`任务 ${taskId} 恢复请求已发送到队列管理器`);
      } else {
        logger.info(`任务 ${taskId} 恢复失败，可能任务不存在或不在暂停状态`);
      }
      
    } catch (error) {
      logger.error(`恢复任务 ${taskId} 失败: ${error}`);
      throw error;
    }
  }
}
