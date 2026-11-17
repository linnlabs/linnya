import { onRendererPluginPush } from '@plugin/renderer/pluginPushClient';
import { KnowledgeTaskStatusViewSchema } from '../../../../shared';

/** 推送仅来自插件声明的 channel；保留早到更新回放与低频校准，停用时撤销订阅。 */
export function createSetupIpcStatusListener(state, updateTaskState, _pendingUpdatesByDocId, fetchDocuments, setupPollingFallback, setupCalibrationPolling) {
  return function setupIpcStatusListener() {
    const handleStatusUpdate = payload => {
      const statusUpdate = KnowledgeTaskStatusViewSchema.parse(payload);
      const exactTask = state.uploadTasks.get(statusUpdate.taskId);
      const matchedTasks = exactTask ? [exactTask] : Array.from(state.uploadTasks.values()).filter(task => task.docId === statusUpdate.docId);
      if (matchedTasks.length === 0) {
        state.setPendingTaskUpdate(statusUpdate.taskId, {
          ...statusUpdate, updated_at: statusUpdate.updatedAt, timestamp: statusUpdate.updatedAt,
        });
        return;
      }
      for (const task of matchedTasks) {
        updateTaskState(task.id, {
          ...statusUpdate, updated_at: statusUpdate.updatedAt, timestamp: statusUpdate.updatedAt,
        });
      }
      if (['completed', 'duplicate', 'failed'].includes(statusUpdate.status)) {
        for (const kbId of new Set(matchedTasks.map(task => task.kbId))) void fetchDocuments(kbId);
      }
    };
    try {
      state.ipcCleanup = onRendererPluginPush('knowledge', 'task-status-updated', handleStatusUpdate);
      setupCalibrationPolling();
    } catch (error) {
      console.error('[KnowledgeUpload] 订阅任务状态失败，启用正式任务轮询', error);
      setupPollingFallback();
    }
  };
}
