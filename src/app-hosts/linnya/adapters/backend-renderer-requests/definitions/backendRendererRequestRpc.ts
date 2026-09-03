import type { AppServerRpcRequestOptions } from '../../../app-server-rpc';

export const BACKEND_RENDERER_REQUEST_LIST_RPC_METHOD =
  'backend.renderer_requests.list' as const;
export const BACKEND_RENDERER_REQUEST_INVOKE_RPC_METHOD =
  'backend.renderer_requests.invoke' as const;

export const BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION = 1 as const;
export const BACKEND_RENDERER_REQUEST_INLINE_MAX_BYTES = 384 * 1024;
export const BACKEND_RENDERER_REQUEST_MAILBOX_METADATA_MAX_BYTES = 8 * 1024 * 1024;
export const BACKEND_RENDERER_REQUEST_MAILBOX_CONTENT_MAX_BYTES = 80 * 1024 * 1024;
export const BACKEND_RENDERER_REQUEST_EXTERNAL_LEAF_MIN_BYTES = 64 * 1024;

export interface BackendRendererRequestRpcGatewayPort {
  listChannels(): Promise<readonly string[]>;
  invoke(
    channel: string,
    args: readonly unknown[],
    options?: AppServerRpcRequestOptions,
  ): Promise<unknown>;
}
