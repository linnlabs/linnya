import { z } from 'zod';
import { ScheduledTaskNotificationSchema, type ScheduledTaskNotification } from '@app/schemas/scheduled-tasks';
import type { AppServerRpcHandlerRegistry, AppServerRpcPeer } from '../../app-server-rpc';

const NOTIFY_METHOD = 'desktop.scheduled_tasks.notify';
export type NotifyScheduledTask = (notification: ScheduledTaskNotification) => void | Promise<void>;

export function createScheduledTaskNotificationClient(rpc: Pick<AppServerRpcPeer, 'request'>) {
  return async (notification: ScheduledTaskNotification): Promise<void> => {
    const result = await rpc.request(NOTIFY_METHOD, ScheduledTaskNotificationSchema.parse(notification));
    z.null().parse(result);
  };
}

export function createScheduledTaskNotificationHandlers(notify: NotifyScheduledTask): AppServerRpcHandlerRegistry {
  return new Map([[NOTIFY_METHOD, async payload => {
    await notify(ScheduledTaskNotificationSchema.parse(payload));
    return null;
  }]]);
}
