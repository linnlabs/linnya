import { SCHEDULED_TASKS_NOTIFY_CHANNEL, type ScheduledTaskNotification } from '@app/schemas/scheduled-tasks';
import { createDesktopNoticeDelivery } from '../desktop-notice/createDesktopNoticeDelivery';
import { describeScheduledTaskNotice } from './functions/describeScheduledTaskNotice';

export function createScheduledTaskDesktopNotifications() {
  return createDesktopNoticeDelivery<ScheduledTaskNotification>({
    channel: SCHEDULED_TASKS_NOTIFY_CHANNEL,
    describe: describeScheduledTaskNotice,
  });
}
