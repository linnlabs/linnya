/**
 * 应用更新的 Main ↔ Renderer 合同。
 *
 * Main 持有唯一的更新状态，每次变化推送完整快照；Renderer 只渲染快照并发起动作，
 * 页面重载后用 get-state 取回当前状态，不依赖漏收的事件。
 */

export const APP_UPDATE_STATE_CHANNEL = 'app-update:state' as const;
export const APP_UPDATE_GET_STATE_CHANNEL = 'app-update:get-state' as const;
export const APP_UPDATE_CHECK_CHANNEL = 'app-update:check' as const;
export const APP_UPDATE_DOWNLOAD_CHANNEL = 'app-update:download' as const;
export const APP_UPDATE_CANCEL_DOWNLOAD_CHANNEL = 'app-update:cancel-download' as const;
export const APP_UPDATE_INSTALL_CHANNEL = 'app-update:install' as const;
export const APP_UPDATE_ACKNOWLEDGE_INSTALLED_CHANNEL = 'app-update:acknowledge-installed' as const;

export type AppUpdateStatus =
  /** 没有可用更新，或检查失败（后台检查失败保持静默）。 */
  | 'idle'
  | 'available'
  | 'downloading'
  /** 网络中断，等待自动重试。 */
  | 'paused'
  | 'ready'
  | 'installing'
  /** 下载或安装失败，需要用户重试。 */
  | 'failed';

export type AppUpdateFailureKind =
  | 'network'
  /** SHA-512 或 macOS 代码签名校验失败，下载文件已丢弃。 */
  | 'integrity'
  | 'disk'
  /** macOS 不在“应用程序”文件夹里运行，无法原地替换。 */
  | 'location'
  | 'install'
  | 'unknown';

export interface AppUpdateProgress {
  /** 0–1；还不知道总大小时为 null。 */
  readonly fraction: number | null;
  readonly transferredBytes: number;
  readonly totalBytes: number | null;
  readonly bytesPerSecond: number | null;
}

export interface AppUpdateFailure {
  readonly kind: AppUpdateFailureKind;
  /** 自动重试的时间（ISO）；不会自动重试时为 null。 */
  readonly retryAt: string | null;
}

export interface AppUpdateState {
  /** 当前发行版是否允许官方更新；为 false 时入口永远不出现。 */
  readonly enabled: boolean;
  readonly status: AppUpdateStatus;
  readonly currentVersion: string;
  readonly version: string | null;
  readonly releaseNotes: string | null;
  readonly progress: AppUpdateProgress | null;
  readonly failure: AppUpdateFailure | null;
  /** 本次启动刚从旧版本更新而来，Renderer 显示一次提示后确认。 */
  readonly installedVersion: string | null;
}

export type AppUpdateCheckResult =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'up-to-date' }
  | { readonly kind: 'available'; readonly version: string }
  | { readonly kind: 'busy' }
  | { readonly kind: 'failed'; readonly failureKind: AppUpdateFailureKind };

export type AppUpdateActivityKind = 'conversation' | 'commands' | 'knowledge_ingestion';

export interface AppUpdateActivity {
  /** 用于确认比对：重启前出现确认时没有的 key 就要重新询问。 */
  readonly key: string;
  readonly kind: AppUpdateActivityKind;
  readonly title: string | null;
}

export interface AppUpdateInstallRequest {
  readonly confirmedActivityKeys: readonly string[];
}

export type AppUpdateInstallResult =
  | { readonly outcome: 'confirmation_required'; readonly activities: readonly AppUpdateActivity[] }
  | { readonly outcome: 'installing' }
  /** 用户在保存或退出确认阶段选择留下。 */
  | { readonly outcome: 'kept_open' }
  | { readonly outcome: 'not_ready' }
  | { readonly outcome: 'failed' };

export function isAppUpdateInstallRequest(value: unknown): value is AppUpdateInstallRequest {
  if (typeof value !== 'object' || value === null) return false;
  const keys = (value as { confirmedActivityKeys?: unknown }).confirmedActivityKeys;
  return Array.isArray(keys) && keys.every(key => typeof key === 'string');
}
