/** 5 分钟内第 3 次意外停止就不再自动重启（与 VS Code 扩展进程相同的取舍）。 */
export const APP_SERVER_CRASH_WINDOW_MS = 5 * 60 * 1000;
export const APP_SERVER_MAX_AUTOMATIC_RESTARTS = 2;

export interface AppServerCrashDecision {
  /** 去掉窗口外记录、加入本次后的历史，供持久化。 */
  readonly history: readonly number[];
  readonly action: 'relaunch' | 'stop';
}

/** 记一次意外停止，并决定自动重启还是交给用户。 */
export function recordAppServerCrash(
  previous: readonly number[],
  now: number,
): AppServerCrashDecision {
  const recent = previous.filter(at => Number.isFinite(at) && at > now - APP_SERVER_CRASH_WINDOW_MS && at <= now);
  const history = [...recent, now];
  return {
    history,
    action: history.length > APP_SERVER_MAX_AUTOMATIC_RESTARTS ? 'stop' : 'relaunch',
  };
}
