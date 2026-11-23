import {
  ConversationRunScheduledTasksSchema,
  ScheduledTaskDeleteResultSchema,
  ScheduledTaskMutationResultSchema,
  ScheduledTaskNotificationSchema,
  ScheduledTaskPreviewScheduleResultSchema,
  ScheduledTaskRunsResultSchema,
  ScheduledTaskSettingsSchema,
  ScheduledTasksListResultSchema,
  type ConversationRunScheduledTasks,
  type ConversationRunScheduledTasksRequest,
  type ScheduledTaskCreateRequest,
  type ScheduledTaskDeleteRequest,
  type ScheduledTaskDeleteResult,
  type ScheduledTaskMutationResult,
  type ScheduledTaskNotification,
  type ScheduledTaskPreviewScheduleResult,
  type ScheduledTaskRunsRequest,
  type ScheduledTaskRunsResult,
  type ScheduledTaskSchedule,
  type ScheduledTaskSettings,
  type ScheduledTasksListRequest,
  type ScheduledTasksListResult,
  type ScheduledTaskUpdateRequest,
} from '@app/schemas/scheduled-tasks';

/**
 * Renderer 到 App Server 的唯一入口：经 preload 调 channel，结果一律按合同解析后才交出去。
 * 定时、名额、下次运行时间都以 App Server 的结果为准，这里不做任何推算。
 */
function api() {
  return window.electronAPI.scheduledTasks;
}

export const scheduledTasksClient = {
  async list(request: ScheduledTasksListRequest = {}): Promise<ScheduledTasksListResult> {
    return ScheduledTasksListResultSchema.parse(await api().list(request));
  },
  async runs(request: ScheduledTaskRunsRequest): Promise<ScheduledTaskRunsResult> {
    return ScheduledTaskRunsResultSchema.parse(await api().runs(request));
  },
  async create(request: ScheduledTaskCreateRequest): Promise<ScheduledTaskMutationResult> {
    return ScheduledTaskMutationResultSchema.parse(await api().create(request));
  },
  async update(request: ScheduledTaskUpdateRequest): Promise<ScheduledTaskMutationResult> {
    return ScheduledTaskMutationResultSchema.parse(await api().update(request));
  },
  async setEnabled(taskId: string, enabled: boolean): Promise<ScheduledTaskMutationResult> {
    return ScheduledTaskMutationResultSchema.parse(await api().setEnabled({ task_id: taskId, enabled }));
  },
  async runNow(taskId: string): Promise<ScheduledTaskMutationResult> {
    return ScheduledTaskMutationResultSchema.parse(await api().runNow({ task_id: taskId }));
  },
  async delete(request: ScheduledTaskDeleteRequest): Promise<ScheduledTaskDeleteResult> {
    return ScheduledTaskDeleteResultSchema.parse(await api().delete(request));
  },
  async markViewed(conversationId: string): Promise<void> {
    await api().markViewed({ conversation_id: conversationId });
  },
  async previewSchedule(schedule: ScheduledTaskSchedule): Promise<ScheduledTaskPreviewScheduleResult> {
    return ScheduledTaskPreviewScheduleResultSchema.parse(await api().previewSchedule({ schedule }));
  },
  async getSettings(): Promise<ScheduledTaskSettings> {
    return ScheduledTaskSettingsSchema.parse(await api().getSettings());
  },
  async setSettings(settings: ScheduledTaskSettings): Promise<ScheduledTaskSettings> {
    return ScheduledTaskSettingsSchema.parse(await api().setSettings(settings));
  },
  async listForConversationRuns(request: ConversationRunScheduledTasksRequest): Promise<ConversationRunScheduledTasks> {
    return ConversationRunScheduledTasksSchema.parse(await api().listForConversationRuns(request));
  },
  onChanged(callback: () => void): () => void {
    return api().onChanged(callback);
  },
  /**
   * `open` 为 false：窗口在前台，Main 转来做应用内提示；为 true：用户点了系统通知，要打开对应位置。
   * 解析失败的通知只记日志，不影响界面。
   */
  onNotify(callback: (notification: ScheduledTaskNotification, open: boolean) => void): () => void {
    return api().onNotify((payload, open) => {
      const parsed = ScheduledTaskNotificationSchema.safeParse(payload);
      if (parsed.success) callback(parsed.data, open);
      else console.warn('[scheduled-tasks] 收到无法识别的通知', parsed.error.issues);
    });
  },
};
