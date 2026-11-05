export const APP_SERVER_CONTROL_SCHEMA_VERSION = 1 as const;
export const APP_SERVER_CONTROL_PROTOCOL_VERSION = 3 as const;
export const APP_SERVER_CONTROL_MAX_FRAME_BYTES = 16 * 1024;

export interface AppServerControlReadyFrame {
  readonly schema_version: typeof APP_SERVER_CONTROL_SCHEMA_VERSION;
  readonly kind: 'ready';
  readonly protocol_version: typeof APP_SERVER_CONTROL_PROTOCOL_VERSION;
  readonly daemon_epoch: string;
  readonly pid: number;
  readonly application_version: string;
  readonly api_port: number;
  readonly renderer_session_token: string;
  readonly database_ready: true;
}

export interface AppServerControlRequestFrame {
  readonly schema_version: typeof APP_SERVER_CONTROL_SCHEMA_VERSION;
  readonly kind: 'request';
  readonly request_id: string;
  readonly operation: 'ping' | 'shutdown';
}

export interface AppServerControlResponseFrame {
  readonly schema_version: typeof APP_SERVER_CONTROL_SCHEMA_VERSION;
  readonly kind: 'response';
  readonly request_id: string;
  readonly operation: AppServerControlRequestFrame['operation'];
  readonly daemon_epoch: string;
}

/**
 * 启动期数据库阶段的进度：打开数据库、数据格式升级、插件迁移与建索引。
 * 每次启动 `started` 与 `finished` 各一次，`progress` 在每个升级步骤完成后发出。
 */
export interface AppServerStartupProgress {
  readonly state: 'started' | 'progress' | 'finished';
  /** 这次启动是否有数据格式升级；只有升级时 Desktop 才可能显示升级界面。 */
  readonly upgrading: boolean;
  readonly completedSteps: number;
  readonly totalSteps: number;
}

export interface AppServerControlStartupProgressFrame {
  readonly schema_version: typeof APP_SERVER_CONTROL_SCHEMA_VERSION;
  readonly kind: 'startup_progress';
  readonly state: AppServerStartupProgress['state'];
  readonly upgrading: boolean;
  readonly completed_steps: number;
  readonly total_steps: number;
}

export interface AppServerControlFatalFrame {
  readonly schema_version: typeof APP_SERVER_CONTROL_SCHEMA_VERSION;
  readonly kind: 'fatal';
  readonly code: 'startup_failed' | 'protocol_failed' | 'shutdown_failed';
  readonly message: string;
}

export type AppServerParentControlFrame = AppServerControlRequestFrame;

export type AppServerChildControlFrame =
  | AppServerControlReadyFrame
  | AppServerControlStartupProgressFrame
  | AppServerControlResponseFrame
  | AppServerControlFatalFrame;
