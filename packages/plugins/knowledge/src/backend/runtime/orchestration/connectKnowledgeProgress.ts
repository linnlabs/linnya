import { isObjectLike } from '@linnya/foundation';
import { broadcastRendererPluginMessage } from '@plugin/backend/pluginRendererPush';
import { Logger } from '@plugin/backend/loggingRuntime';
import { rm } from 'node:fs/promises';
import type { KnowledgeQueues } from '../../queue/orchestration/KnowledgeQueues';
import type { OriginalDocumentRepository } from '../../infrastructure/originalDocumentRepository';
import {
  syncCompletionToIngestionStore,
  syncProgressToIngestionStore,
} from '../../ingestion/orchestration/workerIngestionProgressProjection';
import { updateIngestionProgress } from '../../ingestion/store/ingestionProgressStore';
import type { StatusUpdatePublisher } from '../../ingestion/definitions/statusUpdate';

const logger = new Logger('KnowledgeProgress');
function text(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === 'string' ? record[key] : undefined;
}
function number(record: Record<string, unknown>, key: string, fallback: number): number {
  return typeof record[key] === 'number' ? record[key] : fallback;
}
function publish(taskId: string, docId: string, state: Record<string, unknown>) {
  const message = text(state, 'message');
  const error = text(state, 'error');
  broadcastRendererPluginMessage('knowledge', 'task-status-updated', {
    taskId,
    docId,
    status: text(state, 'status') ?? 'processing',
    progress: number(state, 'progress', 0),
    stage: text(state, 'stage') ?? '',
    stage_progress: number(state, 'stage_progress', 0),
    updatedAt: number(state, 'updated_at', Date.now()),
    ...(message === undefined ? {} : { message }),
    ...(error === undefined ? {} : { error }),
  });
}
function publishKnowledgeStatus(
  event: Parameters<StatusUpdatePublisher>[0],
  canPublish: () => boolean
): void {
  syncProgressToIngestionStore(event.frontendState, { filename: event.filename });
  if (canPublish()) publish(event.taskId, event.docId, { ...event.frontendState });
}

/** 队列归属已冻结，重复上传只清理本次新原件，不能碰旧文档身份。 */
export function connectKnowledgeProgress(
  queues: KnowledgeQueues,
  originals: OriginalDocumentRepository
) {
  let publishing = true;
  const canPublish = () => publishing;
  const cleanups = new Set<Promise<void>>();
  const subscriptions = [
    queues.subscribeToEvent('ingestion:taskProgress', event => {
      const job = queues.getTaskById(event.taskId);
      if (!job || !isObjectLike(event.data)) return;
      syncProgressToIngestionStore(event.data, { filename: job.data.filename });
      if (publishing) publish(event.taskId, job.data.docId, event.data);
    }),
    queues.subscribeToEvent('ingestion:taskCompleted', event => {
      const job = queues.getTaskById(event.taskId);
      if (!job || !isObjectLike(event.result)) return;
      syncCompletionToIngestionStore(event.result, { filename: job.data.filename });
      const duplicate = event.result.duplicate === true;
      const state = isObjectLike(event.result.frontendState) ? event.result.frontendState : {};
      if (publishing)
        publish(event.taskId, job.data.docId, {
          ...state,
          status: duplicate ? 'duplicate' : 'completed',
          message: duplicate ? (text(state, 'message') ?? '重复文件') : '已完成',
          progress: 100,
          stage: 'completed',
          stage_progress: 100,
        });
      if (duplicate) {
        const operation = Promise.all([
          originals.delete(job.data.kbId, job.data.docId),
          rm(job.data.filePath, { force: true }),
        ]).then(() => undefined);
        queues.getExecution(event.taskId)?.track(operation);
        const cleanup = operation
          .catch(error => logger.error('清理本次重复上传失败', { docId: job.data.docId, error }))
          .finally(() => cleanups.delete(cleanup));
        cleanups.add(cleanup);
      }
    }),
    queues.subscribeToEvent('ingestion:taskFailed', event => {
      const job = queues.getTaskById(event.taskId);
      if (!job) return;
      const state = {
        doc_id: job.data.docId,
        filename: job.data.filename,
        status: 'failed' as const,
        message: '处理失败',
        error: event.error,
        progress: 0,
        stage: 'failed',
        stage_progress: 0,
        updated_at: Date.now(),
      };
      updateIngestionProgress(job.data.docId, state);
      if (publishing) publish(event.taskId, job.data.docId, state);
    }),
  ];
  return {
    statusUpdatePublisher: (event =>
      publishKnowledgeStatus(event, canPublish)) satisfies StatusUpdatePublisher,
    // disabled 后 SDK 正确拒绝发布；内部完成/失败/清理订阅必须继续活到 settled。
    stopPublishing() {
      publishing = false;
    },
    async dispose() {
      publishing = false;
      for (const dispose of subscriptions) dispose();
      await Promise.all(cleanups);
    },
  };
}
