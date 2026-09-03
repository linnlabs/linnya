import type { PluginCredentialRuntimePort, PluginCredentialStatus } from './pluginCredentialRuntime';

const PLUGIN_CREDENTIALS_STORE_KEY = 'pluginCredentials';

type PluginCredentialStoreShape = Record<string, Record<string, string>>;

interface ElectronStoreLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export function createElectronStorePluginCredentialRuntimePort(
  store: ElectronStoreLike,
): PluginCredentialRuntimePort {
  return {
    async read(pluginId, key) {
      const value = readCredentialStore(store)[pluginId]?.[key];
      return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
    },
    async listStatus(pluginId, keys) {
      const credentials = readCredentialStore(store)[pluginId] ?? {};
      return keys.map((key) => ({
        key,
        configured: typeof credentials[key] === 'string' && credentials[key].trim().length > 0,
      }));
    },
    async write(pluginId, values) {
      const credentials = readCredentialStore(store);
      const pluginCredentials = { ...(credentials[pluginId] ?? {}) };
      for (const [key, value] of Object.entries(values)) {
        const trimmed = value?.trim();
        if (trimmed === undefined || trimmed.length === 0) {
          delete pluginCredentials[key];
          continue;
        }
        pluginCredentials[key] = trimmed;
      }
      store.set(PLUGIN_CREDENTIALS_STORE_KEY, {
        ...credentials,
        [pluginId]: pluginCredentials,
      });
      return credentialStatuses(pluginCredentials, Object.keys(values).sort());
    },
    async clearForTest(pluginId) {
      const credentials = readCredentialStore(store);
      const next = { ...credentials };
      delete next[pluginId];
      store.set(PLUGIN_CREDENTIALS_STORE_KEY, next);
    },
  };
}

function readCredentialStore(store: ElectronStoreLike): PluginCredentialStoreShape {
  const raw = store.get(PLUGIN_CREDENTIALS_STORE_KEY);
  if (!isRecord(raw)) return {};
  const result: PluginCredentialStoreShape = {};
  for (const [pluginId, pluginValue] of Object.entries(raw)) {
    if (!isRecord(pluginValue)) continue;
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(pluginValue)) {
      if (typeof value === 'string') values[key] = value;
    }
    result[pluginId] = values;
  }
  return result;
}

function credentialStatuses(
  credentials: Record<string, string>,
  keys: readonly string[],
): readonly PluginCredentialStatus[] {
  return keys.map((key) => ({
    key,
    configured: typeof credentials[key] === 'string' && credentials[key].trim().length > 0,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
