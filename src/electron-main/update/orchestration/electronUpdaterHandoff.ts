import { app } from 'electron';
import { autoUpdater } from 'electron-updater';

import type {
  UpdateHandoffMode,
  UpdateHandoffPort,
} from '../../app-lifecycle/definitions/appShutdownLifecycle';

/**
 * Squirrel.Mac 在 handoff 后才从本地代理取包并校验签名；校验失败时它只发 error、不会退出。
 * 资源此时已经收口，进程不能停在无窗口状态，所以兜底按失败退出，旧版本保持可用。
 */
const HANDOFF_EXIT_FALLBACK_MS = 90_000;

let downloadedUpdateReady = false;

export function setDownloadedUpdateReady(ready: boolean): void {
  downloadedUpdateReady = ready;
}

export function createElectronUpdaterHandoff(): UpdateHandoffPort {
  return Object.freeze({
    isReady: () => downloadedUpdateReady,
    handoff(mode: UpdateHandoffMode) {
      if (!downloadedUpdateReady) throw new Error('更新尚未下载完成，不能开始安装');
      downloadedUpdateReady = false;
      const relaunch = mode === 'restart';
      setTimeout(() => app.exit(relaunch ? 1 : 0), HANDOFF_EXIT_FALLBACK_MS).unref();
      autoUpdater.once('error', () => app.exit(relaunch ? 1 : 0));
      if (process.platform === 'win32') {
        // NSIS：静默安装；只有“重启以更新”才在安装后重新打开。
        autoUpdater.quitAndInstall(true, relaunch);
        return;
      }
      // macOS：autoRunAppAfterInstall=false 时 Squirrel 取包完成后普通退出，下次启动即新版本。
      autoUpdater.autoRunAppAfterInstall = relaunch;
      autoUpdater.quitAndInstall();
    },
  });
}
