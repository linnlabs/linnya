import type { JsonValue } from '@app/schemas';

export const APP_SERVER_RPC_SCHEMA_VERSION = 1 as const;
export const APP_SERVER_RPC_MAX_FRAME_BYTES = 1024 * 1024;
export const APP_SERVER_RPC_MAX_PENDING_REQUESTS = 64;
export const APP_SERVER_RPC_MAX_PENDING_WRITES = 128;
export const APP_SERVER_RPC_DEFAULT_TIMEOUT_MS = 30_000;

export interface AppServerRpcRequestFrame {
  readonly schema_version: typeof APP_SERVER_RPC_SCHEMA_VERSION;
  readonly kind: 'request';
  readonly request_id: string;
  readonly method: string;
  readonly payload: JsonValue;
}

export interface AppServerRpcSuccessFrame {
  readonly schema_version: typeof APP_SERVER_RPC_SCHEMA_VERSION;
  readonly kind: 'response';
  readonly request_id: string;
  readonly ok: true;
  readonly result: JsonValue;
}

export type AppServerRpcErrorCode =
  | 'method_not_registered'
  | 'handler_capacity_exceeded'
  | 'handler_failed'
  | 'cancelled';

export interface AppServerRpcFailureFrame {
  readonly schema_version: typeof APP_SERVER_RPC_SCHEMA_VERSION;
  readonly kind: 'response';
  readonly request_id: string;
  readonly ok: false;
  readonly error: {
    readonly code: AppServerRpcErrorCode;
    readonly message: string;
  };
}

export interface AppServerRpcCancelFrame {
  readonly schema_version: typeof APP_SERVER_RPC_SCHEMA_VERSION;
  readonly kind: 'cancel';
  readonly request_id: string;
}

export type AppServerRpcFrame =
  | AppServerRpcRequestFrame
  | AppServerRpcSuccessFrame
  | AppServerRpcFailureFrame
  | AppServerRpcCancelFrame;
