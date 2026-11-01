import { autoUpdater, CancellationToken } from 'electron-updater';

import type {
  AppUpdateCancellation,
  AppUpdateDownloadProgress,
  AppUpdaterPort,
} from '../definitions/appUpdatePorts';

class ElectronUpdateCancellation implements AppUpdateCancellation {
  readonly token = new CancellationToken();

  cancel(): void {
    this.token.cancel();
  }
}

/**
 * electron-updater 的唯一适配层。只用 promise 结果驱动状态，不依赖它的 error 事件：
 * 同一次失败会同时 reject 并 emit error，两边都处理会把一次断网算成两次。
 */
export function createElectronAppUpdaterPort(): AppUpdaterPort {
  // stable 渠道：不接受预发布，不允许降级；下载与安装都由用户动作和 shutdown owner 驱动。
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  // 失败只经 promise 处理；保留一个空监听，避免 EventEmitter 把未监听的 error 当作未捕获异常。
  autoUpdater.on('error', () => {});

  return Object.freeze({
    async checkForUpdates() {
      const result = await autoUpdater.checkForUpdates();
      if (!result || result.isUpdateAvailable === false) return null;
      return {
        version: result.updateInfo.version,
        releaseNotes: result.updateInfo.releaseNotes,
      };
    },

    async downloadUpdate(cancellation: AppUpdateCancellation) {
      const token = cancellation instanceof ElectronUpdateCancellation ? cancellation.token : undefined;
      await autoUpdater.downloadUpdate(token);
    },

    createCancellation: () => new ElectronUpdateCancellation(),

    onDownloadProgress(listener: (progress: AppUpdateDownloadProgress) => void) {
      autoUpdater.on('download-progress', listener);
    },
  });
}
