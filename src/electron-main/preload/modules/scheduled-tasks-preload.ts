import type { IpcRenderer } from 'electron';
import {
  CONVERSATION_RUN_SCHEDULED_TASKS_CHANNEL,
  SCHEDULED_TASKS_CHANGED_CHANNEL,
  SCHEDULED_TASKS_CREATE_CHANNEL,
  SCHEDULED_TASKS_DELETE_CHANNEL,
  SCHEDULED_TASKS_LIST_CHANNEL,
  SCHEDULED_TASKS_MARK_VIEWED_CHANNEL,
  SCHEDULED_TASKS_NOTIFY_CHANNEL,
  SCHEDULED_TASKS_PREVIEW_SCHEDULE_CHANNEL,
  SCHEDULED_TASKS_RUN_NOW_CHANNEL,
  SCHEDULED_TASKS_RUNS_CHANNEL,
  SCHEDULED_TASKS_SET_ENABLED_CHANNEL,
  SCHEDULED_TASKS_SETTINGS_GET_CHANNEL,
  SCHEDULED_TASKS_SETTINGS_SET_CHANNEL,
  SCHEDULED_TASKS_UPDATE_CHANNEL,
  type ConversationRunScheduledTasksRequest,
  type ScheduledTaskCreateRequest,
  type ScheduledTaskDeleteRequest,
  type ScheduledTaskMarkViewedRequest,
  type ScheduledTaskPreviewScheduleRequest,
  type ScheduledTaskRunNowRequest,
  type ScheduledTaskRunsRequest,
  type ScheduledTaskSetEnabledRequest,
  type ScheduledTaskSettings,
  type ScheduledTasksListRequest,
  type ScheduledTaskUpdateRequest,
} from '@app/schemas/scheduled-tasks';

/** 返回值都未校验；Renderer 必须用 `@app/schemas/scheduled-tasks` 的 schema 解析后再用。 */
export function buildScheduledTasksPreloadApi(ipcRenderer: IpcRenderer) {
  const listen = (channel: string, callback: (payload: unknown) => void): (() => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
  return {
    scheduledTasks: {
      list: (request: ScheduledTasksListRequest): Promise<unknown> => ipcRenderer.invoke(SCHEDULED_TASKS_LIST_CHANNEL, request),
      runs: (request: ScheduledTaskRunsRequest): Promise<unknown> => ipcRenderer.invoke(SCHEDULED_TASKS_RUNS_CHANNEL, request),
      create: (request: ScheduledTaskCreateRequest): Promise<unknown> => ipcRenderer.invoke(SCHEDULED_TASKS_CREATE_CHANNEL, request),
      update: (request: ScheduledTaskUpdateRequest): Promise<unknown> => ipcRenderer.invoke(SCHEDULED_TASKS_UPDATE_CHANNEL, request),
      setEnabled: (request: ScheduledTaskSetEnabledRequest): Promise<unknown> => (
        ipcRenderer.invoke(SCHEDULED_TASKS_SET_ENABLED_CHANNEL, request)
      ),
      runNow: (request: ScheduledTaskRunNowRequest): Promise<unknown> => ipcRenderer.invoke(SCHEDULED_TASKS_RUN_NOW_CHANNEL, request),
      delete: (request: ScheduledTaskDeleteRequest): Promise<unknown> => ipcRenderer.invoke(SCHEDULED_TASKS_DELETE_CHANNEL, request),
      markViewed: (request: ScheduledTaskMarkViewedRequest): Promise<unknown> => (
        ipcRenderer.invoke(SCHEDULED_TASKS_MARK_VIEWED_CHANNEL, request)
      ),
      previewSchedule: (request: ScheduledTaskPreviewScheduleRequest): Promise<unknown> => (
        ipcRenderer.invoke(SCHEDULED_TASKS_PREVIEW_SCHEDULE_CHANNEL, request)
      ),
      getSettings: (): Promise<unknown> => ipcRenderer.invoke(SCHEDULED_TASKS_SETTINGS_GET_CHANNEL, {}),
      setSettings: (request: ScheduledTaskSettings): Promise<unknown> => (
        ipcRenderer.invoke(SCHEDULED_TASKS_SETTINGS_SET_CHANNEL, request)
      ),
      listForConversationRuns: (request: ConversationRunScheduledTasksRequest): Promise<unknown> => (
        ipcRenderer.invoke(CONVERSATION_RUN_SCHEDULED_TASKS_CHANNEL, request)
      ),
      /** 任务或运行记录变了；推送不带数据，收到后重新读取。 */
      onChanged: (callback: () => void): (() => void) => listen(SCHEDULED_TASKS_CHANGED_CHANNEL, () => callback()),
      /** 窗口在前台时 Main 把通知转给 Renderer 做应用内提示；payload 须用 ScheduledTaskNotificationSchema 解析。 */
      onNotify: (callback: (payload: unknown) => void): (() => void) => listen(SCHEDULED_TASKS_NOTIFY_CHANNEL, callback),
    },
  };
}
