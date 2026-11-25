import * as contract from '@app/schemas/scheduled-tasks';
import type { ScheduledTasks } from '../../../application/scheduled-tasks';
import type { BackendRendererRequestRegistryPort } from '../definitions/backendRendererRequest';

export function registerScheduledTaskRequests(tasks: ScheduledTasks, registry: BackendRendererRequestRegistryPort): void {
  registry.handle(contract.SCHEDULED_TASKS_LIST_CHANNEL, async request => contract.ScheduledTasksListResultSchema.parse(
    await tasks.list(contract.ScheduledTasksListRequestSchema.parse(request).project_id),
  ));
  registry.handle(contract.SCHEDULED_TASKS_RUNS_CHANNEL, async request => {
    const { task_id, limit, before_planned_at } = contract.ScheduledTaskRunsRequestSchema.parse(request);
    return contract.ScheduledTaskRunsResultSchema.parse(await tasks.runs(task_id, limit, before_planned_at));
  });
  registry.handle(contract.SCHEDULED_TASKS_CREATE_CHANNEL, async request => contract.ScheduledTaskMutationResultSchema.parse(
    await tasks.create(contract.ScheduledTaskCreateRequestSchema.parse(request)),
  ));
  registry.handle(contract.SCHEDULED_TASKS_UPDATE_CHANNEL, async request => contract.ScheduledTaskMutationResultSchema.parse(
    await tasks.update(contract.ScheduledTaskUpdateRequestSchema.parse(request)),
  ));
  registry.handle(contract.SCHEDULED_TASKS_SET_ENABLED_CHANNEL, async request => {
    const { task_id, enabled } = contract.ScheduledTaskSetEnabledRequestSchema.parse(request);
    return contract.ScheduledTaskMutationResultSchema.parse(await tasks.setEnabled(task_id, enabled));
  });
  registry.handle(contract.SCHEDULED_TASKS_RUN_NOW_CHANNEL, async request => contract.ScheduledTaskMutationResultSchema.parse(
    await tasks.runNow(contract.ScheduledTaskRunNowRequestSchema.parse(request).task_id),
  ));
  registry.handle(contract.SCHEDULED_TASKS_DELETE_CHANNEL, async request => contract.ScheduledTaskDeleteResultSchema.parse(
    await tasks.delete(contract.ScheduledTaskDeleteRequestSchema.parse(request)),
  ));
  registry.handle(contract.SCHEDULED_TASKS_MARK_VIEWED_CHANNEL, async request => {
    await tasks.markViewed(contract.ScheduledTaskMarkViewedRequestSchema.parse(request).conversation_id);
    return null;
  });
  registry.handle(contract.SCHEDULED_TASKS_PREVIEW_SCHEDULE_CHANNEL, request => {
    const { schedule, run_days_in } = contract.ScheduledTaskPreviewScheduleRequestSchema.parse(request);
    return contract.ScheduledTaskPreviewScheduleResultSchema.parse(tasks.preview(schedule, run_days_in));
  });
  registry.handle(contract.SCHEDULED_TASKS_SETTINGS_GET_CHANNEL, () => contract.ScheduledTaskSettingsSchema.parse(tasks.getSettings()));
  registry.handle(contract.SCHEDULED_TASKS_SETTINGS_SET_CHANNEL, async request => contract.ScheduledTaskSettingsSchema.parse(
    await tasks.setSettings(contract.ScheduledTaskSettingsSetRequestSchema.parse(request)),
  ));
  registry.handle(contract.CONVERSATION_RUN_SCHEDULED_TASKS_CHANNEL, async request => contract.ConversationRunScheduledTasksSchema.parse(
    await tasks.changes(contract.ConversationRunScheduledTasksRequestSchema.parse(request)),
  ));
}
