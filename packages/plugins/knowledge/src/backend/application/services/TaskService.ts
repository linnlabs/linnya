import { Logger } from '@plugin/backend/loggingRuntime';
import type { KnowledgeQueues } from '../../queue/orchestration/KnowledgeQueues';
import type { MetadataRepository } from '../../infrastructure/metadataRepository';
import { DocumentStatus } from '../../domain/document';

export interface KnowledgeGraphTaskControl {
  cancelGraphExtractionTasksByDoc(kbId: string, docId: string): Promise<number>;
  cancelGraphIndexingTasksByDoc(kbId: string, docId: string): Promise<number>;
  cancelGraphExtractionTasksByKb(kbId: string): Promise<number>;
  cancelGraphIndexingTasksByKb(kbId: string): Promise<number>;
  refreshKbGraphProgress(kbId: string): void;
}
export interface TaskServiceDeps {
  metadataRepository: MetadataRepository;
  queues: KnowledgeQueues;
  graphTasks: KnowledgeGraphTaskControl;
}

/** 只控制本次 activation 的知识库任务，删除前等待真实停止，不能降级为“继续删除”。 */
export class TaskService {
  private readonly logger = new Logger('KnowledgeTaskService');
  constructor(private readonly deps: TaskServiceDeps) {}

  async cancelTasksForDocumentDeletion(kbId: string, docId: string): Promise<void> {
    await this.deps.graphTasks.cancelGraphExtractionTasksByDoc(kbId, docId);
    await this.deps.graphTasks.cancelGraphIndexingTasksByDoc(kbId, docId);
    for (const job of this.deps.queues.listIngestionTasks()) {
      if (job.data.kbId === kbId && job.data.docId === docId)
        await this.deps.queues.cancelIngestionTask(job.id);
    }
  }
  async cancelTasksForKnowledgeBaseDeletion(kbId: string): Promise<void> {
    await this.deps.graphTasks.cancelGraphExtractionTasksByKb(kbId);
    await this.deps.graphTasks.cancelGraphIndexingTasksByKb(kbId);
    for (const job of this.deps.queues.listIngestionTasks()) {
      if (job.data.kbId === kbId) await this.deps.queues.cancelIngestionTask(job.id);
    }
  }
  async refreshKbGraphProgress(kbId: string): Promise<void> {
    this.deps.graphTasks.refreshKbGraphProgress(kbId);
  }
  async cancelTask(taskId: string): Promise<void> {
    const task = this.deps.queues.getTaskById(taskId);
    const cancelled = await this.deps.queues.cancelIngestionTask(taskId);
    if (!cancelled || !task) return;
    const updated = await this.deps.metadataRepository.updateDocumentStatus(
      task.data.docId,
      DocumentStatus.FAILED,
      '用户取消'
    );
    if (!updated)
      this.logger.info('已取消任务的文档记录不存在', { taskId, docId: task.data.docId });
  }
}
