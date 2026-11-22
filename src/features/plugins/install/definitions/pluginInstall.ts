import type { PluginId, PluginOperationErrorCode, PluginRemoteUpdateCheckResult } from '@app/schemas';

export interface RemotePluginVersionManifest {
  readonly version: string;
  readonly minApp?: string;
  readonly rendererUi?: string;
  readonly url: string;
  readonly sha512: string;
}

/** 已验签 catalog 对本次安装的来源证明；暂存成功后写入安装回执，启动期据此准入。 */
export interface CatalogInstallProvenance {
  readonly keyId: string;
  readonly digest: string;
  readonly sequence: number;
  readonly envelope: string;
}

export interface RemotePluginRelease extends RemotePluginVersionManifest {
  readonly provenance?: CatalogInstallProvenance;
}

/**
 * 远程版本来源。official 组合使用已验签 catalog；未签名 latest.json 只留给开发与 R2 smoke。
 * 找不到可安装版本时抛出 PluginOperationError；不兼容时返回最高版本条目，由调用方给出跳过原因。
 */
export interface RemotePluginReleaseSource {
  resolve(input: {
    readonly pluginId: PluginId;
    readonly appVersion: string;
    readonly rendererUiVersion: string;
    readonly fetch: typeof fetch;
  }): Promise<RemotePluginRelease>;
}

export interface InstallPluginUpdateOptions {
  readonly pluginId: PluginId;
  /** 与 releaseSource 二选一；只用于开发与 R2 smoke 的未签名 latest.json。 */
  readonly latestManifestUrl?: string;
  readonly releaseSource?: RemotePluginReleaseSource;
  readonly userPluginRoot: string;
  readonly appVersion: string;
  readonly rendererUiVersion: string;
  readonly currentVersion?: string | null;
  readonly fetch?: typeof fetch;
}

export interface CheckPluginRemoteUpdateOptions {
  readonly pluginId: PluginId;
  readonly latestManifestUrl?: string;
  readonly releaseSource?: RemotePluginReleaseSource;
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
      readonly errorCode?: PluginOperationErrorCode;
    };
