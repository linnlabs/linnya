import type {
  PluginCredentialRuntimePort,
  PluginCredentialStatus,
} from '@linnya/plugin-host-contract/backend/pluginCredentialRuntime';

export type {
  PluginCredentialRuntimePort,
  PluginCredentialStatus,
} from '@linnya/plugin-host-contract/backend/pluginCredentialRuntime';

let credentialRuntimePort: PluginCredentialRuntimePort | null = null;

export function registerPluginCredentialRuntimePort(port: PluginCredentialRuntimePort): void {
  credentialRuntimePort = port;
}

export async function readPluginCredential(pluginId: string, key: string): Promise<string | undefined> {
  return credentialRuntimePort?.read(pluginId, key);
}

export async function listPluginCredentialStatus(
  pluginId: string,
  keys: readonly string[],
): Promise<readonly PluginCredentialStatus[]> {
  return credentialRuntimePort?.listStatus(pluginId, keys)
    ?? keys.map((key) => ({ key, configured: false }));
}

export async function writePluginCredentials(
  pluginId: string,
  values: Readonly<Record<string, string | null | undefined>>,
): Promise<readonly PluginCredentialStatus[]> {
  if (credentialRuntimePort === null) {
    throw new Error('[pluginCredentialRuntime] credential runtime port 尚未注册');
  }
  return credentialRuntimePort.write(pluginId, values);
}

export async function clearPluginCredentialsForTest(pluginId: string): Promise<void> {
  await credentialRuntimePort?.clearForTest?.(pluginId);
}
