import { z } from 'zod';
import type { AppServerRpcHandlerRegistry, AppServerRpcPeer } from '../../app-server-rpc';

const READ_TIMEZONE = 'desktop.scheduled_tasks.read_timezone';
const timezoneSchema = z.string().min(1).max(100);

export function createScheduledTaskTimezoneClient(rpc: Pick<AppServerRpcPeer, 'request'>) {
  return async (): Promise<string> => timezoneSchema.parse(await rpc.request(READ_TIMEZONE, null));
}

export function createScheduledTaskTimezoneHandlers(readTimezone: () => Promise<string>): AppServerRpcHandlerRegistry {
  return new Map([[READ_TIMEZONE, async payload => {
    z.null().parse(payload);
    return timezoneSchema.parse(await readTimezone());
  }]]);
}
