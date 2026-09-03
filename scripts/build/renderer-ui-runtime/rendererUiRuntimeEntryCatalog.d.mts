export type RendererUiPluginRuntimeEntryId =
  | 'root'
  | 'icons'
  | 'localization'
  | 'scroll'
  | 'theme'
  | 'version';

export interface RendererUiPluginRuntimeEntry {
  readonly id: RendererUiPluginRuntimeEntryId;
  readonly specifier: string;
  readonly packageExport: string;
  readonly canonicalSource: string;
  readonly cssOnly: false;
  readonly pluginRuntimeExternal: true;
  readonly hostModuleKey: string;
  readonly protocolUrl: string;
  readonly namedExports: readonly string[];
}

export interface RendererUiBundledRuntimeEntry {
  readonly id: 'font-stack';
  readonly specifier: string;
  readonly packageExport: string;
  readonly canonicalSource: string;
  readonly cssOnly: false;
  readonly pluginRuntimeExternal: false;
  readonly hostModuleKey: null;
  readonly protocolUrl: null;
  readonly namedExports: readonly string[];
}

export interface RendererUiAssetEntry {
  readonly id: null;
  readonly specifier: string;
  readonly packageExport: string;
  readonly canonicalSource: string;
  readonly cssOnly: true;
  readonly pluginRuntimeExternal: false;
  readonly hostModuleKey: null;
  readonly protocolUrl: null;
  readonly namedExports: readonly [];
}

export type RendererUiRuntimeEntry =
  | RendererUiPluginRuntimeEntry
  | RendererUiBundledRuntimeEntry
  | RendererUiAssetEntry;

export const rendererUiRuntimeEntries: readonly RendererUiRuntimeEntry[];
export const rendererUiPluginRuntimeEntries: readonly RendererUiPluginRuntimeEntry[];
