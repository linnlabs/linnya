import type {
  PluginDiskSpaceShortfall,
  PluginId,
  PluginInstallProgress,
  PluginOperationErrorCode,
  PluginRemoteUpdateCheckResult,
} from '@app/schemas';

import type { ResolvedPluginRuntime } from '../../catalog/functions/selectCatalogPluginRelease';

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
  /** catalog 声明的 zip 字节数与解压后字节数；开发用 latest.json 来源没有。 */
  readonly size?: number;
  readonly unpackedSize?: number;
  readonly provenance?: CatalogInstallProvenance;
  /** catalog 解析到本平台的原生运行时；插件安装前先装好。 */
  readonly runtimes?: readonly ResolvedPluginRuntime[];
}

/** 一次下载的取消与进度回调；进度已按时间节流。 */
export interface ArtifactTransferControl {
  readonly signal?: AbortSignal;
  readonly onProgress?: (receivedBytes: number) => void;
  /** 下载完成、开始解压与校验时调用一次。 */
  readonly onInstalling?: () => void;
}

/**
 * 由 Host 组合注入的运行时安装器。pending 返回本机尚未安装或校验不通过、需要下载的运行时，
 * 用于在下载前给出完整进度计划与空间预检；install 失败时抛出 PluginOperationError。
 */
export interface RemotePluginRuntimeInstaller {
  pending(runtimes: readonly ResolvedPluginRuntime[]): Promise<readonly ResolvedPluginRuntime[]>;
  install(
    runtime: ResolvedPluginRuntime,
    provenance: CatalogInstallProvenance,
    control: ArtifactTransferControl,
  ): Promise<void>;
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
    readonly signal?: AbortSignal;
  }): Promise<RemotePluginRelease>;
}

export interface InstallPluginUpdateOptions {
  readonly pluginId: PluginId;
  /** 与 releaseSource 二选一；只用于开发与 R2 smoke 的未签名 latest.json。 */
  readonly latestManifestUrl?: string;
  readonly releaseSource?: RemotePluginReleaseSource;
  readonly installRuntimes?: RemotePluginRuntimeInstaller;
  readonly userPluginRoot: string;
  readonly appVersion: string;
  readonly rendererUiVersion: string;
  readonly currentVersion?: string | null;
  readonly fetch?: typeof fetch;
  /** 取消只在请求 catalog 与下载阶段生效；进入解压与落盘后不再中断，避免留下半个版本目录。 */
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: PluginInstallProgress) => void;
}

export interface CheckPluginRemoteUpdateOptions {
  readonly pluginId: PluginId;
  readonly latestManifestUrl?: string;
  readonly releaseSource?: RemotePluginReleaseSource;
  readonly appVersion: string;
  readonly rendererUiVersion: string;
  readonly currentVersion: string | null;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
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
      readonly diskSpace?: PluginDiskSpaceShortfall;
    };
