import type { JsonValue } from '@app/schemas';

export interface AppServerRpcHandlerContext {
  readonly requestId: string;
  readonly signal: AbortSignal;
}

export type AppServerRpcHandler = (
  payload: JsonValue,
  context: AppServerRpcHandlerContext,
) => JsonValue | Promise<JsonValue>;

export type AppServerRpcHandlerRegistry = ReadonlyMap<string, AppServerRpcHandler>;

export interface AppServerRpcRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface AppServerRpcPeer {
  readonly completed: Promise<void>;
  request(
    method: string,
    payload: JsonValue,
    options?: AppServerRpcRequestOptions,
  ): Promise<JsonValue>;
  dispose(reason?: Error): void;
}
