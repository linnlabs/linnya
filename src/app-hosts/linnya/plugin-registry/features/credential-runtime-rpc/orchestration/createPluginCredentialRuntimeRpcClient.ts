import type { PluginCredentialRuntimePort } from '@linnya/plugin-host-contract/backend/pluginCredentialRuntime';

import type { AppServerRpcPeer } from '../../../../app-server-rpc';
import {
  PLUGIN_CREDENTIAL_LIST_STATUS_RPC_METHOD,
  PLUGIN_CREDENTIAL_READ_RPC_METHOD,
  PLUGIN_CREDENTIAL_WRITE_RPC_METHOD,
} from '../definitions/pluginCredentialRuntimeRpc';
import {
  parsePluginCredentialListStatusRpcResponse,
  parsePluginCredentialReadRpcResponse,
  parsePluginCredentialWriteRpcResponse,
} from '../functions/pluginCredentialRuntimeRpcCodec';

/** App Server 只取得插件凭据业务 port，不取得 Electron Store 或任意 Desktop 存储能力。 */
export function createPluginCredentialRuntimeRpcClient(
  rpc: Pick<AppServerRpcPeer, 'request'>,
): PluginCredentialRuntimePort {
  const port: PluginCredentialRuntimePort = {
    async read(pluginId, key) {
      const response = await rpc.request(PLUGIN_CREDENTIAL_READ_RPC_METHOD, { pluginId, key });
      return parsePluginCredentialReadRpcResponse(response).value ?? undefined;
    },
    async listStatus(pluginId, keys) {
      const response = await rpc.request(PLUGIN_CREDENTIAL_LIST_STATUS_RPC_METHOD, {
        pluginId,
        keys: [...keys],
      });
      return parsePluginCredentialListStatusRpcResponse(response).statuses;
    },
    async write(pluginId, values) {
      const serializableValues: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(values)) {
        // JSON 不表达 undefined；在既有契约里 undefined 与 null 都表示删除。
        serializableValues[key] = value ?? null;
      }
      const response = await rpc.request(PLUGIN_CREDENTIAL_WRITE_RPC_METHOD, {
        pluginId,
        values: serializableValues,
      });
      return parsePluginCredentialWriteRpcResponse(response).statuses;
    },
  };
  return Object.freeze(port);
}
