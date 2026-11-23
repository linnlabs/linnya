import type { ScheduledTaskNotification } from '@app/schemas/scheduled-tasks';
import type { ScheduledTaskMessageResolver } from '../definitions/scheduledTaskMessages';
import { runReasonText } from './presentScheduledTask';

export interface ScheduledTaskNotificationPresentation {
  readonly text: string;
  readonly type: 'info' | 'success' | 'warning' | 'error';
}

/** 窗口在前台时 Main 转来的通知，变成应用内提示的一句话。 */
export function formatScheduledTaskNotification(
  notification: ScheduledTaskNotification,
  message: ScheduledTaskMessageResolver,
): ScheduledTaskNotificationPresentation {
  switch (notification.kind) {
    case 'completed':
      return { text: message('scheduledTasks.notify.completed', { name: notification.task_name }), type: 'success' };
    case 'awaiting_approval':
      return { text: message('scheduledTasks.notify.awaitingApproval', { name: notification.task_name }), type: 'warning' };
    case 'failed':
      return {
        text: message('scheduledTasks.notify.failed', {
          name: notification.task_name,
          reason: runReasonText(notification.reason, message),
        }),
        type: 'error',
      };
    case 'auto_paused':
      return {
        text: message(
          notification.cause === 'failures' ? 'scheduledTasks.notify.autoPausedFailures' : 'scheduledTasks.notify.autoPausedUnviewed',
          { name: notification.task_name },
        ),
        type: 'warning',
      };
    case 'catch_up':
      return { text: message('scheduledTasks.notify.catchUp', { count: notification.task_count }), type: 'info' };
  }
}
