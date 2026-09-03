import { InternalStage } from '../definitions/state';
import type { StatusUpdatePublisher } from '../definitions/statusUpdate';

/**
 * 把摄取领域事件投影为既有 Renderer `task-status-update` payload。
 * channel/BrowserWindow 留在 desktop adapter，本函数可在 App Server 内安全执行。
 */
export function createRendererStatusUpdatePublisher(
  publish: (payload: unknown) => void,
): StatusUpdatePublisher {
  return (event) => {
    const { taskId, docId, filename, stage, frontendState, errorMessage } = event;

    if (stage === InternalStage.COMPLETED || stage === InternalStage.DUPLICATE) {
      const updatedAt = frontendState.updated_at || Date.now();
      publish({
        taskId,
        docId,
        filename: frontendState.filename,
        status: stage === InternalStage.DUPLICATE ? 'duplicate' : 'completed',
        progress: 100,
        message: stage === InternalStage.DUPLICATE ? '重复文件' : '已完成',
        error: null,
        stage: 'completed',
        stage_progress: 100,
        updated_at: updatedAt,
        timestamp: updatedAt,
      });
      return;
    }

    if (stage === InternalStage.FAILED) {
      const updatedAt = Date.now();
      publish({
        taskId,
        docId,
        filename,
        status: 'failed',
        progress: 0,
        message: '处理失败',
        error: errorMessage,
        stage: 'failed',
        stage_progress: 0,
        updated_at: updatedAt,
        timestamp: updatedAt,
      });
      return;
    }

    const updatedAt = frontendState.updated_at || Date.now();
    publish({
      taskId,
      docId: frontendState.doc_id,
      filename: frontendState.filename,
      status: frontendState.status,
      progress: frontendState.progress,
      message: frontendState.message,
      error: frontendState.error,
      stage: frontendState.stage,
      stage_progress: frontendState.stage_progress,
      updated_at: updatedAt,
      timestamp: updatedAt,
    });
  };
}
