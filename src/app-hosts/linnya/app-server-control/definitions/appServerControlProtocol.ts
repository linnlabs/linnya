export const APP_SERVER_CONTROL_SCHEMA_VERSION = 1 as const;
export const APP_SERVER_CONTROL_PROTOCOL_VERSION = 2 as const;
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

export interface AppServerControlFatalFrame {
  readonly schema_version: typeof APP_SERVER_CONTROL_SCHEMA_VERSION;
  readonly kind: 'fatal';
  readonly code: 'startup_failed' | 'protocol_failed' | 'shutdown_failed';
  readonly message: string;
}

export type AppServerParentControlFrame = AppServerControlRequestFrame;

export type AppServerChildControlFrame =
  | AppServerControlReadyFrame
  | AppServerControlResponseFrame
  | AppServerControlFatalFrame;
