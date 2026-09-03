import type { PluginId, PluginRemoteUpdateCheckResult } from '@app/schemas';

export interface RemotePluginVersionManifest {
  readonly version: string;
  readonly minApp?: string;
  readonly rendererUi?: string;
  readonly url: string;
  readonly sha512: string;
}

export interface InstallPluginUpdateOptions {
  readonly pluginId: PluginId;
  readonly latestManifestUrl: string;
  readonly userPluginRoot: string;
  readonly appVersion: string;
  readonly rendererUiVersion: string;
  readonly currentVersion?: string | null;
  readonly fetch?: typeof fetch;
}

export interface CheckPluginRemoteUpdateOptions {
  readonly pluginId: PluginId;
  readonly latestManifestUrl: string;
  readonly appVersion: string;
  readonly rendererUiVersion: string;
  readonly currentVersion: string | null;
  readonly fetch?: typeof fetch;
}

export type CheckPluginRemoteUpdateResult = PluginRemoteUpdateCheckResult;

export type InstallPluginUpdateResult =
  | {
      readonly status: 'staged';
      readonly pluginId: PluginId;
      readonly version: string;
      readonly previousVersion: string | null;
      readonly stagedDir: string;
      readonly restartRequired: true;
    }
  | {
      readonly status: 'skipped';
      readonly pluginId: PluginId;
      readonly version: string;
      readonly reason: 'current' | 'already-staged' | 'incompatible';
      readonly detail?: string;
    }
  | {
      readonly status: 'failed';
      readonly pluginId: PluginId;
      readonly version: string | null;
      readonly error: string;
    };
