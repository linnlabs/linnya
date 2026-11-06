import { describe, expect, it, vi } from 'vitest';

import type { AppShutdownRequestOutcome } from '../../app-lifecycle/definitions/appShutdownLifecycle';
import type { AppUpdateState } from '../../../shared/update/definitions/updateMessage';
import type {
  AppUpdateActivitySnapshot,
  AppUpdateCancellation,
  AppUpdateDownloadProgress,
  AppUpdateReleaseInfo,
} from '../definitions/appUpdatePorts';
import {
  BACKGROUND_CHECK_INTERVAL_MS,
  BACKGROUND_CHECK_RETRY_MS,
  createAppUpdateController,
} from './createAppUpdateController';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function networkError(): Error {
  return Object.assign(new Error('net::ERR_INTERNET_DISCONNECTED'), { code: 'ECONNRESET' });
}

// 与 electron-updater 实测一致：取消错误只有 message，没有 CancellationError 类型名。
function cancellationError(): Error {
  return new Error('cancelled');
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function createHarness(options: {
  currentVersion?: string;
  enabled?: boolean;
  pendingInstall?: string | null;
  locationSupported?: boolean;
  activity?: AppUpdateActivitySnapshot;
  installOutcome?: AppShutdownRequestOutcome;
} = {}) {
  let clock = 1_000_000;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let nextTimer = 1;
  const states: AppUpdateState[] = [];
  const checks: Deferred<AppUpdateReleaseInfo | null>[] = [];
  const downloads: { deferred: Deferred<void>; cancellation: AppUpdateCancellation & { cancelled: boolean } }[] = [];
  let progressListener: ((progress: AppUpdateDownloadProgress) => void) | undefined;
  let pending = options.pendingInstall ?? null;
  let activity = options.activity ?? { hasExecutingCommands: false, activeAgentRuns: [], knowledgeIngestionActive: false };
  const ready: boolean[] = [];
  const pauseAgentRuns = vi.fn(async () => ({ pausedConversationIds: [], unpausableConversationIds: [] }));
  const requestInstall = vi.fn(async () => options.installOutcome ?? 'shutdown_committed' as AppShutdownRequestOutcome);
  const readActivity = vi.fn(async () => activity);

  const controller = createAppUpdateController({
    enabled: options.enabled ?? true,
    currentVersion: options.currentVersion ?? '0.1.0',
    updater: {
      checkForUpdates() {
        const next = deferred<AppUpdateReleaseInfo | null>();
        checks.push(next);
        return next.promise;
      },
      downloadUpdate(cancellation) {
        const next = deferred<void>();
        downloads.push({ deferred: next, cancellation: cancellation as AppUpdateCancellation & { cancelled: boolean } });
        return next.promise;
      },
      createCancellation() {
        const cancellation = {
          cancelled: false,
          cancel() {
            if (cancellation.cancelled) return;
            cancellation.cancelled = true;
            const entry = downloads.find(item => item.cancellation === cancellation);
            entry?.deferred.reject(cancellationError());
          },
        };
        return cancellation;
      },
      onDownloadProgress(listener) { progressListener = listener; },
    },
    activity: {
      read: readActivity,
      pauseAgentRuns,
    },
    isInstallLocationSupported: () => options.locationSupported ?? true,
    setDownloadedUpdateReady: value => { ready.push(value); },
    requestInstall,
    pendingInstall: {
      read: () => pending,
      write: value => { pending = value; },
    },
    publish: state => { states.push(state); },
    timers: {
      now: () => clock,
      setTimeout(callback, delayMs) {
        const id = nextTimer++;
        timers.set(id, { at: clock + delayMs, callback });
        return id;
      },
      clearTimeout(handle) { timers.delete(handle as number); },
    },
    log: () => {},
  });

  async function advance(ms: number): Promise<void> {
    clock += ms;
    for (const [id, timer] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at <= clock && timers.has(id)) {
        timers.delete(id);
        timer.callback();
      }
    }
    await flush();
  }

  return {
    controller,
    states,
    checks,
    downloads,
    ready,
    pauseAgentRuns,
    requestInstall,
    readActivity,
    advance,
    emitProgress: (progress: AppUpdateDownloadProgress) => progressListener?.(progress),
    setActivity: (next: AppUpdateActivitySnapshot) => { activity = next; },
    readPending: () => pending,
    pendingTimers: () => [...timers.values()].map(timer => timer.at - clock).sort((a, b) => a - b),
  };
}

async function reachAvailable(harness: ReturnType<typeof createHarness>, version = '0.1.1') {
  harness.controller.start();
  harness.checks[harness.checks.length - 1]!.resolve({ version, releaseNotes: '修复若干问题' });
  await flush();
}

async function reachReady(harness: ReturnType<typeof createHarness>, version = '0.1.1') {
  await reachAvailable(harness, version);
  const download = harness.controller.download();
  harness.downloads[harness.downloads.length - 1]!.deferred.resolve();
  await download;
}

describe('createAppUpdateController', () => {
  it('只在更新源版本严格更新且为正式版本时出现入口', async () => {
    for (const candidate of ['0.1.0', '0.0.9', '0.1.1-beta.1', 'next', '']) {
      const harness = createHarness();
      harness.controller.start();
      harness.checks[0].resolve({ version: candidate });
      await flush();
      expect(harness.controller.getState().status).toBe('idle');
    }
    const harness = createHarness();
    await reachAvailable(harness, '0.2.0');
    expect(harness.controller.getState()).toMatchObject({ status: 'available', version: '0.2.0', releaseNotes: '修复若干问题' });
  });

  it('非官方发行版不检查也不出现入口', async () => {
    const harness = createHarness({ enabled: false });
    harness.controller.start();
    expect(harness.checks).toHaveLength(0);
    await expect(harness.controller.check()).resolves.toEqual({ kind: 'disabled' });
    expect(harness.controller.getState()).toMatchObject({ enabled: false, status: 'idle' });
  });

  it('后台检查失败保持静默并在 30 分钟后重试，成功后按 4 小时间隔检查', async () => {
    const harness = createHarness();
    harness.controller.start();
    harness.checks[0].reject(Object.assign(new Error('404 Not Found'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' }));
    await flush();
    expect(harness.states).toHaveLength(0);
    expect(harness.pendingTimers()).toEqual([BACKGROUND_CHECK_RETRY_MS]);

    await harness.advance(BACKGROUND_CHECK_RETRY_MS);
    expect(harness.checks).toHaveLength(2);
    harness.checks[1].resolve(null);
    await flush();
    expect(harness.pendingTimers()).toEqual([BACKGROUND_CHECK_INTERVAL_MS]);
  });

  it('手动检查返回失败原因，但不改变入口状态', async () => {
    const harness = createHarness();
    const result = harness.controller.check();
    harness.checks[0].reject(networkError());
    await expect(result).resolves.toEqual({ kind: 'failed', failureKind: 'network' });
    expect(harness.controller.getState().status).toBe('idle');
  });

  it('后台与手动检查同时发生时只请求一次', async () => {
    const harness = createHarness();
    harness.controller.start();
    const manual = harness.controller.check();
    expect(harness.checks).toHaveLength(1);
    harness.checks[0].resolve({ version: '0.1.1' });
    await expect(manual).resolves.toEqual({ kind: 'available', version: '0.1.1' });
  });

  it('更新源撤回版本后入口消失', async () => {
    const harness = createHarness();
    await reachAvailable(harness);
    const result = harness.controller.check();
    harness.checks[1].resolve(null);
    await expect(result).resolves.toEqual({ kind: 'up-to-date' });
    expect(harness.controller.getState()).toMatchObject({ status: 'idle', version: null });
  });

  it('下载进度按节流发布，完成后进入 ready 并记录待安装版本', async () => {
    const harness = createHarness();
    await reachAvailable(harness);
    const download = harness.controller.download();
    expect(harness.controller.getState().status).toBe('downloading');
    harness.emitProgress({ percent: 10, transferred: 10, total: 100, bytesPerSecond: 5 });
    harness.emitProgress({ percent: 20, transferred: 20, total: 100, bytesPerSecond: 5 });
    expect(harness.controller.getState().progress).toMatchObject({ fraction: 0.2, transferredBytes: 20, totalBytes: 100 });
    const published = harness.states.filter(state => state.status === 'downloading' && state.progress?.fraction);
    expect(published).toHaveLength(1);

    harness.downloads[0].deferred.resolve();
    await download;
    expect(harness.controller.getState()).toMatchObject({ status: 'ready', progress: null });
    expect(harness.ready).toEqual([false, true]);
    expect(harness.readPending()).toBe('0.1.1');
  });

  it('下载到一半断网：转为 paused，按退避自动重试并最终完成', async () => {
    const harness = createHarness();
    await reachAvailable(harness);
    void harness.controller.download();
    harness.emitProgress({ percent: 46, transferred: 46, total: 100 });
    harness.downloads[0].deferred.reject(networkError());
    await flush();
    expect(harness.controller.getState()).toMatchObject({ status: 'paused', failure: { kind: 'network' } });

    await harness.advance(5_000);
    expect(harness.downloads).toHaveLength(2);
    harness.downloads[1].deferred.reject(networkError());
    await flush();
    expect(harness.pendingTimers()[0]).toBe(15_000);

    await harness.advance(15_000);
    harness.downloads[2].deferred.resolve();
    await flush();
    expect(harness.controller.getState()).toMatchObject({ status: 'ready', failure: null });
  });

  it('断网时用户点重试立即重新下载，并取消等待中的自动重试', async () => {
    const harness = createHarness();
    await reachAvailable(harness);
    void harness.controller.download();
    harness.downloads[0].deferred.reject(networkError());
    await flush();
    void harness.controller.download();
    expect(harness.downloads).toHaveLength(2);
    expect(harness.pendingTimers().filter(delay => delay <= 5_000)).toEqual([]);
  });

  it('校验失败、磁盘不足不自动重试，需要用户再次下载', async () => {
    for (const [error, kind] of [
      [new Error('sha512 checksum mismatch, expected abc'), 'integrity'],
      [new Error('Code signature at URL file:///x did not pass validation'), 'integrity'],
      [Object.assign(new Error('write failed'), { code: 'ENOSPC' }), 'disk'],
    ] as const) {
      const harness = createHarness();
      await reachAvailable(harness);
      void harness.controller.download();
      harness.downloads[0].deferred.reject(error);
      await flush();
      expect(harness.controller.getState()).toMatchObject({ status: 'failed', failure: { kind, retryAt: null } });
      expect(harness.ready).toEqual([false]);
      void harness.controller.download();
      expect(harness.downloads).toHaveLength(2);
    }
  });

  it('取消下载回到 available；重复点击只发起一次下载', async () => {
    const harness = createHarness();
    await reachAvailable(harness);
    void harness.controller.download();
    void harness.controller.download();
    expect(harness.downloads).toHaveLength(1);
    harness.controller.cancelDownload();
    await flush();
    expect(harness.controller.getState()).toMatchObject({ status: 'available', progress: null });
  });

  it('macOS 不在应用程序文件夹时不下载并给出位置提示', async () => {
    const harness = createHarness({ locationSupported: false });
    await reachAvailable(harness);
    await harness.controller.download();
    expect(harness.downloads).toHaveLength(0);
    expect(harness.controller.getState()).toMatchObject({ status: 'failed', failure: { kind: 'location' } });
  });

  it('下载期间跳过后台检查；已下载后发现更新的版本时在后台替换下载', async () => {
    const harness = createHarness();
    await reachAvailable(harness);
    void harness.controller.download();
    await harness.advance(BACKGROUND_CHECK_INTERVAL_MS);
    expect(harness.checks).toHaveLength(1);
    harness.downloads[0].deferred.resolve();
    await flush();

    await harness.advance(BACKGROUND_CHECK_INTERVAL_MS);
    harness.checks[1].resolve({ version: '0.1.2' });
    await flush();
    expect(harness.controller.getState()).toMatchObject({ status: 'downloading', version: '0.1.2' });
    expect(harness.ready[harness.ready.length - 1]).toBe(false);
    expect(harness.readPending()).toBeNull();
  });

  it('有任务时先要求确认，确认后暂停 Agent 运行再安装', async () => {
    const harness = createHarness({
      activity: {
        hasExecutingCommands: true,
        activeAgentRuns: [{ conversationId: 'c1', conversationTitle: '整理销售数据' }],
        knowledgeIngestionActive: false,
      },
    });
    await reachReady(harness);
    const first = await harness.controller.install({ confirmedActivityKeys: [] });
    expect(first).toEqual({
      outcome: 'confirmation_required',
      activities: [
        { key: 'conversation:c1', kind: 'conversation', title: '整理销售数据' },
        { key: 'commands', kind: 'commands', title: null },
      ],
    });
    expect(harness.controller.getState().status).toBe('ready');
    expect(harness.requestInstall).not.toHaveBeenCalled();

    await expect(harness.controller.install({ confirmedActivityKeys: ['conversation:c1', 'commands'] }))
      .resolves.toEqual({ outcome: 'installing' });
    expect(harness.pauseAgentRuns).toHaveBeenCalledOnce();
    expect(harness.requestInstall).toHaveBeenCalledOnce();
    expect(harness.pauseAgentRuns.mock.invocationCallOrder[0])
      .toBeLessThan(harness.requestInstall.mock.invocationCallOrder[0]);
  });

  it('确认之后又开始了新任务：重新询问，不悄悄停掉它', async () => {
    const harness = createHarness({
      activity: { hasExecutingCommands: false, activeAgentRuns: [{ conversationId: 'c1', conversationTitle: null }], knowledgeIngestionActive: false },
    });
    await reachReady(harness);
    harness.setActivity({
      hasExecutingCommands: false,
      activeAgentRuns: [{ conversationId: 'c1', conversationTitle: null }, { conversationId: 'c2', conversationTitle: '新任务' }],
      knowledgeIngestionActive: true,
    });
    const result = await harness.controller.install({ confirmedActivityKeys: ['conversation:c1'] });
    expect(result).toMatchObject({ outcome: 'confirmation_required' });
    expect(harness.pauseAgentRuns).not.toHaveBeenCalled();
  });

  it('没有任务时直接安装；保存失败或用户留下时回到 ready', async () => {
    const harness = createHarness({ installOutcome: 'kept_open' });
    await reachReady(harness);
    await expect(harness.controller.install({ confirmedActivityKeys: [] })).resolves.toEqual({ outcome: 'kept_open' });
    expect(harness.pauseAgentRuns).not.toHaveBeenCalled();
    expect(harness.controller.getState().status).toBe('ready');
  });

  it('活动查询失败时明确报告安装失败，不能冒充空快照跳过任务确认', async () => {
    const harness = createHarness();
    await reachReady(harness);
    harness.readActivity.mockRejectedValueOnce(new Error('activity RPC timeout'));
    await expect(harness.controller.install({ confirmedActivityKeys: [] })).resolves.toEqual({ outcome: 'failed' });
    expect(harness.controller.getState()).toMatchObject({ status: 'failed', failure: { kind: 'install' } });
    expect(harness.pauseAgentRuns).not.toHaveBeenCalled();
    expect(harness.requestInstall).not.toHaveBeenCalled();
  });

  it('安装请求抛错时进入 failed(install)，未下载完成时拒绝安装', async () => {
    const notReady = createHarness();
    await reachAvailable(notReady);
    await expect(notReady.controller.install({ confirmedActivityKeys: [] })).resolves.toEqual({ outcome: 'not_ready' });

    const harness = createHarness();
    harness.requestInstall.mockRejectedValueOnce(new Error('handoff failed'));
    await reachReady(harness);
    await expect(harness.controller.install({ confirmedActivityKeys: [] })).resolves.toEqual({ outcome: 'failed' });
    expect(harness.controller.getState()).toMatchObject({ status: 'failed', failure: { kind: 'install' } });
  });

  it('启动时识别上一次退出已完成安装，确认后清除提示', () => {
    const installed = createHarness({ currentVersion: '0.1.1', pendingInstall: '0.1.1' });
    expect(installed.controller.getState().installedVersion).toBe('0.1.1');
    expect(installed.readPending()).toBeNull();
    installed.controller.acknowledgeInstalled();
    expect(installed.controller.getState().installedVersion).toBeNull();

    const notInstalled = createHarness({ currentVersion: '0.1.0', pendingInstall: '0.1.1' });
    expect(notInstalled.controller.getState().installedVersion).toBeNull();
    expect(notInstalled.readPending()).toBeNull();
  });
});
