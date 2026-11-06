import type {
  AppUpdateCheckResult,
  AppUpdateFailure,
  AppUpdateInstallRequest,
  AppUpdateInstallResult,
  AppUpdateProgress,
  AppUpdateState,
  AppUpdateStatus,
} from '../../../shared/update/definitions/updateMessage';
import type {
  AppUpdateActivitySnapshot,
  AppUpdateCancellation,
  AppUpdateControllerPorts,
  AppUpdateDownloadProgress,
  AppUpdateReleaseInfo,
} from '../definitions/appUpdatePorts';
import { classifyUpdateError } from '../functions/classifyUpdateError';
import { isNewerReleaseVersion } from '../functions/isNewerReleaseVersion';
import { resolveUpdateRetryDelay } from '../functions/resolveUpdateRetryDelay';
import { resolveUpdateActivities } from '../functions/resolveUpdateActivities';

export const BACKGROUND_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const BACKGROUND_CHECK_RETRY_MS = 30 * 60 * 1000;
const PROGRESS_PUBLISH_INTERVAL_MS = 250;

export interface AppUpdateController {
  getState(): AppUpdateState;
  /** 开始后台检查：立即检查一次，之后定时检查。重复调用无副作用。 */
  start(): void;
  /** 用户主动检查；失败原因只在这里返回，后台检查失败保持静默。 */
  check(): Promise<AppUpdateCheckResult>;
  download(): Promise<void>;
  cancelDownload(): void;
  install(request: AppUpdateInstallRequest): Promise<AppUpdateInstallResult>;
  acknowledgeInstalled(): void;
  dispose(): void;
}

function normalizeReleaseNotes(notes: unknown): string | null {
  if (typeof notes === 'string') return notes.trim() || null;
  if (!Array.isArray(notes)) return null;
  const joined = notes
    .map(entry => (typeof entry === 'object' && entry !== null ? (entry as { note?: unknown }).note : null))
    .filter((note): note is string => typeof note === 'string' && note.trim() !== '')
    .join('\n\n');
  return joined || null;
}

function toProgress(progress: AppUpdateDownloadProgress): AppUpdateProgress {
  const total = typeof progress.total === 'number' && progress.total > 0 ? progress.total : null;
  const transferred = typeof progress.transferred === 'number' ? progress.transferred : 0;
  const fraction = typeof progress.percent === 'number'
    ? Math.min(1, Math.max(0, progress.percent / 100))
    : total ? Math.min(1, transferred / total) : null;
  return {
    fraction,
    transferredBytes: transferred,
    totalBytes: total,
    bytesPerSecond: typeof progress.bytesPerSecond === 'number' ? progress.bytesPerSecond : null,
  };
}

/**
 * 应用更新的唯一状态 owner。
 *
 * - 后台检查只在发现新版本时改变状态；失败只写日志并稍后重试，不打扰用户。
 * - 下载由用户点击发起；断网转为 paused 并按退避自动重试，取消回到 available。
 * - 下载期间不检查；已下载后发现更新的版本，直接在后台替换下载（用户已经同意过更新）。
 * - 安装前读取 App Server 活动：出现确认时没有的任务就重新询问，确认后先暂停 Agent 运行，
 *   再交给 App shutdown owner 完成保存、收口和 updater handoff。
 */
export function createAppUpdateController(ports: AppUpdateControllerPorts): AppUpdateController {
  let status: AppUpdateStatus = 'idle';
  let version: string | null = null;
  let releaseNotes: string | null = null;
  let progress: AppUpdateProgress | null = null;
  let failure: AppUpdateFailure | null = null;
  let installedVersion: string | null = null;

  let started = false;
  let disposed = false;
  let checking: Promise<AppUpdateReleaseInfo | null> | undefined;
  let checkTimer: unknown;
  let retryTimer: unknown;
  let activeCancellation: AppUpdateCancellation | undefined;
  // 用户取消以本地记录为准：electron-updater 抛出的取消错误在不同路径上形状不一。
  const userCancelled = new WeakSet<AppUpdateCancellation>();
  let networkAttempts = 0;
  let lastProgressPublishAt = 0;

  const pending = ports.pendingInstall.read();
  if (pending) {
    // 下载完成时记下目标版本；启动时已是该版本，说明上一次退出完成了安装。
    if (pending === ports.currentVersion) installedVersion = pending;
    else ports.log('上次下载的更新没有在退出时安装', { pending, current: ports.currentVersion });
    ports.pendingInstall.write(null);
  }

  function snapshot(): AppUpdateState {
    return Object.freeze({
      enabled: ports.enabled,
      status,
      currentVersion: ports.currentVersion,
      version,
      releaseNotes,
      progress,
      failure,
      installedVersion,
    });
  }

  function publish(): void {
    if (!disposed) ports.publish(snapshot());
  }

  function clearRetryTimer(): void {
    if (retryTimer !== undefined) ports.timers.clearTimeout(retryTimer);
    retryTimer = undefined;
  }

  function scheduleCheck(delayMs: number): void {
    if (disposed) return;
    if (checkTimer !== undefined) ports.timers.clearTimeout(checkTimer);
    checkTimer = ports.timers.setTimeout(() => {
      checkTimer = undefined;
      void runBackgroundCheck();
    }, delayMs);
  }

  function fetchRelease(): Promise<AppUpdateReleaseInfo | null> {
    // 后台与手动检查同时发生时共享一次请求，避免 electron-updater 内部状态交错。
    checking ??= ports.updater.checkForUpdates().finally(() => { checking = undefined; });
    return checking;
  }

  function applyRelease(release: AppUpdateReleaseInfo | null): AppUpdateCheckResult {
    if (!release || !isNewerReleaseVersion(release.version, ports.currentVersion)) {
      if (status === 'available') {
        // 更新源撤回了版本：入口消失，不保留已经不存在的提示。
        status = 'idle';
        version = null;
        releaseNotes = null;
        publish();
      }
      return { kind: 'up-to-date' };
    }

    const notes = normalizeReleaseNotes(release.releaseNotes);
    if (status === 'ready' || status === 'installing') {
      if (status === 'ready' && release.version !== version
        && isNewerReleaseVersion(release.version, version ?? ports.currentVersion)) {
        version = release.version;
        releaseNotes = notes;
        void startDownload();
      }
      return { kind: 'available', version: version ?? release.version };
    }
    if (status === 'failed' && release.version === version) {
      return { kind: 'available', version: release.version };
    }
    status = 'available';
    version = release.version;
    releaseNotes = notes;
    failure = null;
    publish();
    return { kind: 'available', version: release.version };
  }

  function isBusy(): boolean {
    return status === 'downloading' || status === 'paused' || status === 'installing';
  }

  async function runBackgroundCheck(): Promise<void> {
    if (disposed || !ports.enabled) return;
    if (isBusy()) {
      scheduleCheck(BACKGROUND_CHECK_INTERVAL_MS);
      return;
    }
    try {
      applyRelease(await fetchRelease());
      scheduleCheck(BACKGROUND_CHECK_INTERVAL_MS);
    } catch (error: unknown) {
      ports.log('后台检查更新失败，稍后重试', { kind: classifyUpdateError(error), error: String(error) });
      scheduleCheck(BACKGROUND_CHECK_RETRY_MS);
    }
  }

  async function startDownload(): Promise<void> {
    clearRetryTimer();
    activeCancellation?.cancel();
    const cancellation = ports.updater.createCancellation();
    activeCancellation = cancellation;
    ports.setDownloadedUpdateReady(false);
    ports.pendingInstall.write(null);
    status = 'downloading';
    progress = { fraction: null, transferredBytes: 0, totalBytes: null, bytesPerSecond: null };
    failure = null;
    publish();

    try {
      await ports.updater.downloadUpdate(cancellation);
      if (activeCancellation !== cancellation || disposed) return;
      activeCancellation = undefined;
      networkAttempts = 0;
      status = 'ready';
      progress = null;
      ports.setDownloadedUpdateReady(true);
      if (version) ports.pendingInstall.write(version);
      publish();
    } catch (error: unknown) {
      if (activeCancellation !== cancellation || disposed) return;
      activeCancellation = undefined;
      const kind = userCancelled.has(cancellation) ? 'cancelled' : classifyUpdateError(error);
      ports.log('下载更新失败', { kind, error: String(error) });
      if (kind === 'cancelled') {
        status = 'available';
        progress = null;
        publish();
        return;
      }
      if (kind === 'network') {
        const delayMs = resolveUpdateRetryDelay(networkAttempts);
        networkAttempts += 1;
        status = 'paused';
        failure = { kind, retryAt: new Date(ports.timers.now() + delayMs).toISOString() };
        retryTimer = ports.timers.setTimeout(() => {
          retryTimer = undefined;
          if (status === 'paused') void startDownload();
        }, delayMs);
        publish();
        return;
      }
      status = 'failed';
      progress = null;
      failure = { kind, retryAt: null };
      publish();
    }
  }

  ports.updater.onDownloadProgress(next => {
    if (status !== 'downloading') return;
    progress = toProgress(next);
    const now = ports.timers.now();
    if (now - lastProgressPublishAt < PROGRESS_PUBLISH_INTERVAL_MS && progress.fraction !== 1) return;
    lastProgressPublishAt = now;
    publish();
  });

  return Object.freeze({
    getState: snapshot,

    start() {
      if (started || disposed || !ports.enabled) return;
      started = true;
      void runBackgroundCheck();
    },

    async check(): Promise<AppUpdateCheckResult> {
      if (!ports.enabled) return { kind: 'disabled' };
      if (isBusy()) return { kind: 'busy' };
      try {
        const result = applyRelease(await fetchRelease());
        scheduleCheck(BACKGROUND_CHECK_INTERVAL_MS);
        return result;
      } catch (error: unknown) {
        const kind = classifyUpdateError(error);
        ports.log('手动检查更新失败', { kind, error: String(error) });
        return { kind: 'failed', failureKind: kind === 'cancelled' ? 'unknown' : kind };
      }
    },

    async download() {
      if (!ports.enabled) return;
      if (status !== 'available' && status !== 'paused' && status !== 'failed') return;
      if (!version) return;
      if (!ports.isInstallLocationSupported()) {
        status = 'failed';
        failure = { kind: 'location', retryAt: null };
        publish();
        return;
      }
      networkAttempts = status === 'paused' ? networkAttempts : 0;
      await startDownload();
    },

    cancelDownload() {
      if (status === 'downloading') {
        // 下载 promise 以取消错误结束，由 startDownload 统一回到 available。
        if (activeCancellation) userCancelled.add(activeCancellation);
        activeCancellation?.cancel();
        return;
      }
      if (status === 'paused' || status === 'failed') {
        clearRetryTimer();
        networkAttempts = 0;
        status = 'available';
        progress = null;
        failure = null;
        publish();
      }
    },

    async install(request: AppUpdateInstallRequest): Promise<AppUpdateInstallResult> {
      if (status !== 'ready') return { outcome: 'not_ready' };

      let activity: AppUpdateActivitySnapshot;
      try {
        activity = await ports.activity.read();
      } catch (error: unknown) {
        // 已确认 Backend 退出的空快照由 App owner 提供；查询失败不能冒充无任务绕过确认。
        ports.log('安装前读取运行中任务失败', { error: String(error) });
        status = 'failed';
        failure = { kind: 'install', retryAt: null };
        publish();
        return { outcome: 'failed' };
      }
      const confirmed = new Set(request.confirmedActivityKeys);
      const activities = resolveUpdateActivities(activity);
      if (activities.some(activity => !confirmed.has(activity.key))) {
        return { outcome: 'confirmation_required', activities };
      }

      status = 'installing';
      publish();
      try {
        if (activity.activeAgentRuns.length > 0) {
          try {
            await ports.activity.pauseAgentRuns();
          } catch (error: unknown) {
            // 暂停失败不阻止更新：重启后 Runtime 仍会把可恢复的运行恢复为暂停。
            ports.log('暂停运行中任务失败', { error: String(error) });
          }
        }
        const outcome = await ports.requestInstall();
        if (outcome === 'shutdown_committed') return { outcome: 'installing' };
        status = outcome === 'update_not_ready' ? 'available' : 'ready';
        publish();
        return outcome === 'update_not_ready' ? { outcome: 'not_ready' } : { outcome: 'kept_open' };
      } catch (error: unknown) {
        ports.log('安装更新失败', { error: String(error) });
        status = 'failed';
        failure = { kind: 'install', retryAt: null };
        publish();
        return { outcome: 'failed' };
      }
    },

    acknowledgeInstalled() {
      if (installedVersion === null) return;
      installedVersion = null;
      publish();
    },

    dispose() {
      disposed = true;
      clearRetryTimer();
      if (checkTimer !== undefined) ports.timers.clearTimeout(checkTimer);
      checkTimer = undefined;
      activeCancellation?.cancel();
    },
  });
}
