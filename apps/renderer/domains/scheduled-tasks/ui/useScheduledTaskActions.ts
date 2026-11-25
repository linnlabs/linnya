import { ref } from 'vue';
import type { ScheduledTask, ScheduledTaskMutationResult } from '@app/schemas/scheduled-tasks';
import { useNotificationStore } from '@/app/notification';
import { scheduledTasksClient } from '../adapters/scheduledTasksClient';
import { useScheduledTasksStore } from '../store/scheduledTasksStore';
import { useScheduledTaskLocalization } from './useScheduledTaskLocalization';

/**
 * 列表行与详情共用的任务操作：同一时间只做一件，结果以 App Server 返回的任务为准写回 store，
 * 没做成时提示原因。
 */
export function useScheduledTaskActions(readTask: () => ScheduledTask) {
  const { scheduledTaskMessage } = useScheduledTaskLocalization();
  const store = useScheduledTasksStore();
  const notifications = useNotificationStore();
  const busy = ref(false);

  function showFailure(reason: string): void {
    notifications.show(scheduledTaskMessage('scheduledTasks.actionFailed', { reason }), 'error');
  }

  async function exclusively<Result>(action: () => Promise<Result>): Promise<Result | null> {
    if (busy.value) return null;
    busy.value = true;
    try {
      return await action();
    } catch (error: unknown) {
      console.warn('[scheduled-tasks] 操作失败', error);
      showFailure(String(error));
      return null;
    } finally {
      busy.value = false;
    }
  }

  async function mutate(action: () => Promise<ScheduledTaskMutationResult>): Promise<ScheduledTask | null> {
    const result = await exclusively(action);
    if (!result) return null;
    if (result.ok) {
      store.applyTask(result.task);
      return result.task;
    }
    showFailure(result.message);
    return null;
  }

  async function setEnabled(enabled: boolean): Promise<void> {
    await mutate(() => scheduledTasksClient.setEnabled(readTask().id, enabled));
  }

  async function runNow(): Promise<void> {
    const task = await mutate(() => scheduledTasksClient.runNow(readTask().id));
    if (!task) return;
    notifications.show(
      scheduledTaskMessage(task.state === 'queued' ? 'scheduledTasks.runNow.queued' : 'scheduledTasks.runNow.started'),
      'success',
    );
  }

  /** 返回是否已删除；任务已经不在了也算。 */
  async function deleteTask(stopRunning: boolean): Promise<boolean> {
    const taskId = readTask().id;
    const result = await exclusively(() => scheduledTasksClient.delete({ task_id: taskId, stop_running: stopRunning }));
    if (!result) return false;
    if (!result.ok && result.code !== 'task_not_found') {
      showFailure(result.message);
      return false;
    }
    store.removeTask(taskId);
    return true;
  }

  return { busy, setEnabled, runNow, deleteTask };
}
