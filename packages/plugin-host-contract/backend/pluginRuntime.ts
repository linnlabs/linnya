export declare function isPluginRuntimeEnabled(pluginId: string): boolean;

export declare function assertPluginRuntimeEnabled(params: {
  readonly pluginId: string;
  readonly pluginName: string;
  readonly action: string;
  readonly includeExistingDataNote?: boolean;
}): void;
