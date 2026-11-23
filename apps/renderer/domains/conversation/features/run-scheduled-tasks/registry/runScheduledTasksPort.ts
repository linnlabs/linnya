import type { RunScheduledTasksPort } from '../definitions/runScheduledTasks';

let registeredPort: RunScheduledTasksPort | null = null;

export function registerRunScheduledTasksPort(port: RunScheduledTasksPort): void {
  registeredPort = port;
}

/** 未装配（夹具、独立预览）时为 null，不显示卡片。 */
export function findRunScheduledTasksPort(): RunScheduledTasksPort | null {
  return registeredPort;
}
