export interface PluginCredentialStatus {
  readonly key: string;
  readonly configured: boolean;
}

export interface PluginCredentialRuntimePort {
  read(pluginId: string, key: string): Promise<string | undefined>;
  listStatus(pluginId: string, keys: readonly string[]): Promise<readonly PluginCredentialStatus[]>;
  write(
    pluginId: string,
    values: Readonly<Record<string, string | null | undefined>>,
  ): Promise<readonly PluginCredentialStatus[]>;
  clearForTest?(pluginId: string): Promise<void>;
}

export declare function registerPluginCredentialRuntimePort(port: PluginCredentialRuntimePort): void;
export declare function readPluginCredential(pluginId: string, key: string): Promise<string | undefined>;
export declare function listPluginCredentialStatus(
  pluginId: string,
  keys: readonly string[],
): Promise<readonly PluginCredentialStatus[]>;
export declare function writePluginCredentials(
  pluginId: string,
  values: Readonly<Record<string, string | null | undefined>>,
): Promise<readonly PluginCredentialStatus[]>;
export declare function clearPluginCredentialsForTest(pluginId: string): Promise<void>;
