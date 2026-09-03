export interface PluginCliLauncher {
  readonly directory: string;
  readonly commandName: string;
  readonly pluginId: string;
  readonly executablePath: string;
}

export interface PluginCliLauncherManifestV1 {
  readonly schema_version: 1;
  readonly files: readonly {
    readonly plugin_id: string;
    readonly file_name: string;
  }[];
}
