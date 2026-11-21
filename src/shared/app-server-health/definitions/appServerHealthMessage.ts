/**
 * 后台服务（App Server）可用性的 Main ↔ Renderer 合同。
 *
 * Main 持有唯一状态，每次变化推送完整快照；Renderer 页面重载后用 get-state 取回当前状态。
 */

export const APP_SERVER_HEALTH_STATE_CHANNEL = 'app-server-health:state' as const;
export const APP_SERVER_HEALTH_GET_STATE_CHANNEL = 'app-server-health:get-state' as const;
export const APP_SERVER_HEALTH_RESTART_CHANNEL = 'app-server-health:restart' as const;
export const APP_SERVER_HEALTH_OPEN_LOG_FOLDER_CHANNEL = 'app-server-health:open-log-folder' as const;

export type AppServerHealthStatus =
  /** 正常。 */
  | 'ok'
  /** 进程还在，但连续一段时间不回应。 */
  | 'unresponsive'
  /** 后台已停止，应用即将重新启动。 */
  | 'restarting'
  /** 短时间内反复停止，不再自动重启，等用户处理。 */
  | 'stopped'
  /** 本次启动是从后台停止后自动恢复的；几秒后回到 ok。 */
  | 'recovered';

export interface AppServerHealthState {
  readonly status: AppServerHealthStatus;
}

/** 后台不可用：请求必然失败，界面不再逐条报错，也不展示过时的运行状态。 */
export function isAppServerUnavailable(status: AppServerHealthStatus): boolean {
  return status === 'restarting' || status === 'stopped';
}

/**
 * 开发启动器、探针等托管 Electron 的启动器设置此环境变量为 1：需要重开应用时 Main 以
 * {@link APP_LAUNCHER_RELAUNCH_EXIT_CODE} 退出，由启动器重新拉起 Electron（保留 Vite 等它持有的进程）；
 * 未设置时 Main 用 app.relaunch() 自己重开。
 */
export const APP_LAUNCHER_HANDLES_RELAUNCH_ENV = 'LINNYA_LAUNCHER_HANDLES_RELAUNCH' as const;
export const APP_LAUNCHER_RELAUNCH_EXIT_CODE = 75;
