import type { PluginCredentialRuntimePort } from '@linnya/plugin-host-contract/backend/pluginCredentialRuntime';
import {
  CredentialStorageError,
  type CredentialStoragePort,
} from '../../../../shared/credential-storage';

/** 插件只看到自己 namespace 的状态与值，不获得全文件、路径或其他插件的凭据。 */
export function createStoredPluginCredentialRuntimePort(
  storage: CredentialStoragePort
): PluginCredentialRuntimePort {
  const namespace = (pluginId: string): string => `plugin:${pluginId}`;
  function read(pluginId: string): ReadonlyMap<string, string> {
    const values = new Map<string, string>();
    for (const [key, value] of storage.read(namespace(pluginId))) {
      if (typeof value !== 'string') throw new CredentialStorageError('invalid_format');
      values.set(key, value);
    }
    return values;
  }
  return {
    async read(pluginId, key) {
      return read(pluginId).get(key);
    },
    async listStatus(pluginId, keys) {
      const values = read(pluginId);
      return keys.map(key => ({ key, configured: values.has(key) }));
    },
    async write(pluginId, input) {
      read(pluginId);
      const changes = new Map(
        Object.entries(input).map(([key, value]) => [key, value?.trim() || undefined])
      );
      await storage.update(namespace(pluginId), changes);
      const values = read(pluginId);
      return Object.keys(input)
        .sort()
        .map(key => ({ key, configured: values.has(key) }));
    },
    async clearForTest(pluginId) {
      await storage.update(
        namespace(pluginId),
        new Map(Array.from(read(pluginId).keys(), key => [key, undefined]))
      );
    },
  };
}
