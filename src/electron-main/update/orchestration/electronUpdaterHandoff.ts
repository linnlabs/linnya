import { autoUpdater } from 'electron-updater';

import type { UpdateHandoffPort } from '../../app-lifecycle/definitions/appShutdownLifecycle';

let downloadedUpdateReady = false;

export function markDownloadedUpdateReady(): void {
  downloadedUpdateReady = true;
}

export function createElectronUpdaterHandoff(): UpdateHandoffPort {
  return Object.freeze({
    isReady: () => downloadedUpdateReady,
    handoff() {
      if (!downloadedUpdateReady) throw new Error('更新尚未下载完成，不能开始安装');
      downloadedUpdateReady = false;
      if (process.platform === 'win32') {
        autoUpdater.quitAndInstall(true, true);
        return;
      }
      autoUpdater.quitAndInstall();
    },
  });
}
