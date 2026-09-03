import type { PluginCredentialRuntimePort } from '@linnya/plugin-host-contract/backend/pluginCredentialRuntime';

import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../../../../app-server-rpc';
import {
  PLUGIN_CREDENTIAL_LIST_STATUS_RPC_METHOD,
  PLUGIN_CREDENTIAL_READ_RPC_METHOD,
  PLUGIN_CREDENTIAL_WRITE_RPC_METHOD,
} from '../definitions/pluginCredentialRuntimeRpc';
import {
  parsePluginCredentialListStatusRpcRequest,
  parsePluginCredentialReadRpcRequest,
  parsePluginCredentialWriteRpcRequest,
} from '../functions/pluginCredentialRuntimeRpcCodec';

/** Desktop owner 只暴露 read/list/write 三种凭据操作，拒绝任意 Store key 访问。 */
export function createPluginCredentialRuntimeRpcHandlers(
  port: PluginCredentialRuntimePort,
): AppServerRpcHandlerRegistry {
  return new Map<string, AppServerRpcHandler>([
    [PLUGIN_CREDENTIAL_READ_RPC_METHOD, async payload => {
      const request = parsePluginCredentialReadRpcRequest(payload);
      return { value: await port.read(request.pluginId, request.key) ?? null };
    }],
    [PLUGIN_CREDENTIAL_LIST_STATUS_RPC_METHOD, async payload => {
      const request = parsePluginCredentialListStatusRpcRequest(payload);
      const statuses = await port.listStatus(request.pluginId, request.keys);
      return { statuses: statuses.map(status => ({
        key: status.key,
        configured: status.configured,
      })) };
    }],
    [PLUGIN_CREDENTIAL_WRITE_RPC_METHOD, async payload => {
      const request = parsePluginCredentialWriteRpcRequest(payload);
      const statuses = await port.write(request.pluginId, request.values);
      return { statuses: statuses.map(status => ({
        key: status.key,
        configured: status.configured,
      })) };
    }],
  ]);
}
