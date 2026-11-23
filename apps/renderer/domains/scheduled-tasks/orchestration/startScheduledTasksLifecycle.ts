import type { ScheduledTaskNotification } from '@app/schemas/scheduled-tasks';
import { scheduledTasksClient } from '../adapters/scheduledTasksClient';
import { useScheduledTasksStore } from '../store/scheduledTasksStore';
import { refreshScheduledTasks } from './refreshScheduledTasks';

/**
 * 先订阅变化推送，再读一次全量；侧栏角标、视图和折叠行都读同一份 store。
 * `onNotify` 由调用方决定怎么提示（应用内通知归 app 层）。
 */
export function startScheduledTasksLifecycle(
  onNotify: (notification: ScheduledTaskNotification, open: boolean) => void,
): () => void {
  if (!window.electronAPI?.scheduledTasks) return () => undefined;
  const store = useScheduledTasksStore();
  const stopChanged = scheduledTasksClient.onChanged(() => {
    store.noteChanged();
    void refreshScheduledTasks();
  });
  const stopNotify = scheduledTasksClient.onNotify(onNotify);
  void refreshScheduledTasks();
  return () => {
    stopChanged();
    stopNotify();
  };
}
