import type { IpcRenderer } from 'electron';
import * as contract from '@app/schemas/scheduled-tasks';

export function buildScheduledTasksPreloadApi(ipc: IpcRenderer) {
  return {
    list: (request: contract.ScheduledTasksListRequest = {}): Promise<unknown> => ipc.invoke(contract.SCHEDULED_TASKS_LIST_CHANNEL, request),
    runs: (request: contract.ScheduledTaskRunsRequest): Promise<unknown> => ipc.invoke(contract.SCHEDULED_TASKS_RUNS_CHANNEL, request),
    create: (request: contract.ScheduledTaskCreateRequest): Promise<unknown> => ipc.invoke(contract.SCHEDULED_TASKS_CREATE_CHANNEL, request),
    update: (request: contract.ScheduledTaskUpdateRequest): Promise<unknown> => ipc.invoke(contract.SCHEDULED_TASKS_UPDATE_CHANNEL, request),
    setEnabled: (request: contract.ScheduledTaskSetEnabledRequest): Promise<unknown> => ipc.invoke(contract.SCHEDULED_TASKS_SET_ENABLED_CHANNEL, request),
    runNow: (request: contract.ScheduledTaskRunNowRequest): Promise<unknown> => ipc.invoke(contract.SCHEDULED_TASKS_RUN_NOW_CHANNEL, request),
    delete: (request: contract.ScheduledTaskDeleteRequest): Promise<unknown> => ipc.invoke(contract.SCHEDULED_TASKS_DELETE_CHANNEL, request),
    markViewed: (request: contract.ScheduledTaskMarkViewedRequest): Promise<unknown> => ipc.invoke(contract.SCHEDULED_TASKS_MARK_VIEWED_CHANNEL, request),
    previewSchedule: (request: contract.ScheduledTaskPreviewScheduleRequest): Promise<unknown> => ipc.invoke(contract.SCHEDULED_TASKS_PREVIEW_SCHEDULE_CHANNEL, request),
    getSettings: (): Promise<unknown> => ipc.invoke(contract.SCHEDULED_TASKS_SETTINGS_GET_CHANNEL),
    setSettings: (request: contract.ScheduledTaskSettings): Promise<unknown> => ipc.invoke(contract.SCHEDULED_TASKS_SETTINGS_SET_CHANNEL, request),
    listForConversationRuns: (request: contract.ConversationRunScheduledTasksRequest): Promise<unknown> => ipc.invoke(contract.CONVERSATION_RUN_SCHEDULED_TASKS_CHANNEL, request),
    onChanged(listener: () => void): () => void {
      const receive = () => listener();
      ipc.on(contract.SCHEDULED_TASKS_CHANGED_CHANNEL, receive);
      return () => { ipc.removeListener(contract.SCHEDULED_TASKS_CHANGED_CHANNEL, receive); };
    },
    onNotify(listener: (notification: contract.ScheduledTaskNotification, open: boolean) => void): () => void {
      const receive = (_event: unknown, notification: contract.ScheduledTaskNotification, open?: boolean) => listener(notification, open === true);
      ipc.on(contract.SCHEDULED_TASKS_NOTIFY_CHANNEL, receive);
      return () => { ipc.removeListener(contract.SCHEDULED_TASKS_NOTIFY_CHANNEL, receive); };
    },
  };
}
