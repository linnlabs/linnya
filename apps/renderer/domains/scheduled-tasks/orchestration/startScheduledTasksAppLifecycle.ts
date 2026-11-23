import { useLocalization } from '@app/localization';
import { SCHEDULED_TASK_MESSAGE_FALLBACKS } from '../definitions/scheduledTaskMessageCatalog';
import type { ScheduledTaskMessageResolver } from '../definitions/scheduledTaskMessages';
import {
  formatScheduledTaskNotification,
  type ScheduledTaskNotificationPresentation,
} from '../functions/formatScheduledTaskNotification';
import { ensureScheduledTasksLocalizationRegistered } from './ensureScheduledTasksLocalizationRegistered';
import { startScheduledTasksLifecycle } from './startScheduledTasksLifecycle';

/**
 * App 启动时调用：注册文案，订阅任务变化，把 Main 转来的通知（窗口在前台时）交给应用内提示。
 * 提示怎么显示由调用方决定，这个领域不直接依赖 app 层的通知栏。
 */
export function startScheduledTasksAppLifecycle(
  show: (presentation: ScheduledTaskNotificationPresentation) => void,
): () => void {
  ensureScheduledTasksLocalizationRegistered();
  const { message } = useLocalization();
  const resolve: ScheduledTaskMessageResolver = (key, params) =>
    message(key, SCHEDULED_TASK_MESSAGE_FALLBACKS[key], params);
  // 点系统通知（open）由 app 层导航处理，这里只管前台时的应用内提示。
  return startScheduledTasksLifecycle((notification, open) => {
    if (!open) show(formatScheduledTaskNotification(notification, resolve));
  });
}
