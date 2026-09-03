import type { PluginCredentialStatus } from '@linnya/plugin-host-contract/backend/pluginCredentialRuntime';

export const PLUGIN_CREDENTIAL_READ_RPC_METHOD =
  'desktop.plugin_credentials.read' as const;
export const PLUGIN_CREDENTIAL_LIST_STATUS_RPC_METHOD =
  'desktop.plugin_credentials.list_status' as const;
export const PLUGIN_CREDENTIAL_WRITE_RPC_METHOD =
  'desktop.plugin_credentials.write' as const;

export interface PluginCredentialReadRpcRequest {
  readonly pluginId: string;
  readonly key: string;
}

export interface PluginCredentialReadRpcResponse {
  readonly value: string | null;
}

export interface PluginCredentialListStatusRpcRequest {
  readonly pluginId: string;
  readonly keys: readonly string[];
}

export interface PluginCredentialListStatusRpcResponse {
  readonly statuses: readonly PluginCredentialStatus[];
}

export interface PluginCredentialWriteRpcRequest {
  readonly pluginId: string;
  readonly values: Readonly<Record<string, string | null>>;
}

export interface PluginCredentialWriteRpcResponse {
  readonly statuses: readonly PluginCredentialStatus[];
}
