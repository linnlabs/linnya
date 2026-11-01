import type { AppShutdownRequestOutcome } from '../../app-lifecycle/definitions/appShutdownLifecycle';
import type { AppUpdateState } from '../../../shared/update/definitions/updateMessage';

export interface AppUpdateReleaseInfo {
  readonly version: string;
  readonly releaseNotes?: unknown;
}

export interface AppUpdateDownloadProgress {
  readonly percent?: number;
  readonly transferred?: number;
  readonly total?: number;
  readonly bytesPerSecond?: number;
}

export interface AppUpdateCancellation {
  cancel(): void;
}

/** electron-updater 的最小切面；测试用假实现模拟网络、校验和取消。 */
export interface AppUpdaterPort {
  checkForUpdates(): Promise<AppUpdateReleaseInfo | null>;
  downloadUpdate(cancellation: AppUpdateCancellation): Promise<void>;
  createCancellation(): AppUpdateCancellation;
  onDownloadProgress(listener: (progress: AppUpdateDownloadProgress) => void): void;
}

export interface AppUpdateActiveAgentRun {
  readonly conversationId: string;
  readonly conversationTitle: string | null;
}

export interface AppUpdateActivitySnapshot {
  readonly hasExecutingCommands: boolean;
  readonly activeAgentRuns: readonly AppUpdateActiveAgentRun[];
  readonly knowledgeIngestionActive: boolean;
}

/** App Server 的活动事实；Backend 尚未就绪时由调用方给出空快照。 */
export interface AppUpdateActivityPort {
  read(): Promise<AppUpdateActivitySnapshot>;
  pauseAgentRuns(): Promise<unknown>;
}

export interface AppUpdateTimerPort {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AppUpdatePendingInstallStore {
  read(): string | null;
  write(version: string | null): void;
}

export interface AppUpdateControllerPorts {
  readonly enabled: boolean;
  readonly currentVersion: string;
  readonly updater: AppUpdaterPort;
  readonly activity: AppUpdateActivityPort;
  /** macOS 只有在“应用程序”文件夹里才能原地替换。 */
  readonly isInstallLocationSupported: () => boolean;
  /** 下载完成的文件可以交给 updater；新下载开始时作废旧文件。 */
  readonly setDownloadedUpdateReady: (ready: boolean) => void;
  readonly requestInstall: () => Promise<AppShutdownRequestOutcome>;
  readonly pendingInstall: AppUpdatePendingInstallStore;
  readonly publish: (state: AppUpdateState) => void;
  readonly timers: AppUpdateTimerPort;
  readonly log: (message: string, details?: Record<string, unknown>) => void;
}
