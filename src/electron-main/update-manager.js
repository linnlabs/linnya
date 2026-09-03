import { autoUpdater } from 'electron-updater';
import { getMainWindow } from './window-manager.js';
import { Logger } from '../shared/logger.js';
import { markDownloadedUpdateReady } from './update/orchestration/electronUpdaterHandoff.ts';

const updateLogger = new Logger('electron-updater');
autoUpdater.logger = updateLogger;

/**
 * @description 向渲染进程发送状态更新。
 * @param {import('../shared/update/definitions/updateMessage.ts').UpdateMessageChannel} channel - The event channel name.
 * @param {import('../shared/update/definitions/updateMessage.ts').UpdateMessagePayload} [payload] - The event payload.
 */
function sendStatusToWindow(channel, payload) {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send('update-message', { channel, payload });
  }
}

/**
 * @description 只为通过发行清单验签的官方 Desktop 初始化自动更新管理器。
 * @param {import('../shared/distribution-identity/index.ts').DistributionIdentity} distributionIdentity
 */
export function initializeUpdateManager(distributionIdentity) {
  if (distributionIdentity.kind !== 'official') {
    updateLogger.info(`disabled for ${distributionIdentity.kind} distribution`);
    return;
  }

  // 官方包由 electron-builder 的发布配置提供 feed；源码运行不能覆盖到正式更新源。
  // ------- 彻底禁用 GH_TOKEN / GITHUB_TOKEN -------
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  // ------------------------------------------------

  // --- 配置 autoUpdater ---
  // 关闭自动下载，我们需要在用户同意后再开始下载
  autoUpdater.autoDownload = false;
  // 关闭在下载前自动安装的特性
  // 普通退出不能隐式安装；只有 App shutdown owner 完整收口后才能交给 quitAndInstall。
  autoUpdater.autoInstallOnAppQuit = false;

  // --- 监听 autoUpdater 事件 ---
  autoUpdater.on('checking-for-update', () => {
    updateLogger.info('checking-for-update');
    sendStatusToWindow('checking-for-update');
  });

  autoUpdater.on('update-available', (info) => {
    updateLogger.info('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      fileCount: Array.isArray(info.files) ? info.files.length : 0,
    });
    sendStatusToWindow('update-available', info);
  });

  autoUpdater.on('update-not-available', (info) => {
    updateLogger.info('update-not-available', {
      version: info.version,
      releaseDate: info.releaseDate,
    });
    sendStatusToWindow('update-not-available', info);
  });

  autoUpdater.on('error', (err) => {
    updateLogger.error('error', err);
    // 确保传递的是字符串，而不是函数或对象
    let errorMessage = 'Unknown error';
    if (err) {
      if (typeof err.message === 'string') {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      } else {
        try {
          errorMessage = JSON.stringify(err);
        } catch {
          errorMessage = 'Error during update check';
        }
      }
    }
    sendStatusToWindow('error', errorMessage);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    updateLogger.info('download-progress', progressObj);
    sendStatusToWindow('download-progress', progressObj);
  });

  autoUpdater.on('update-downloaded', (info) => {
    markDownloadedUpdateReady();
    updateLogger.info('update-downloaded', {
      version: info.version,
      releaseDate: info.releaseDate,
    });
    sendStatusToWindow('update-downloaded', info);
  });

  // --- IPC 处理器已迁移 ---
  // 所有 updater-* 相关的 IPC 处理器已迁移至 src/electron-main/ipc/handlers/update-ipc.ts
  // 以确保统一注册和管理，避免冲突。
  // 迁移的处理器包括：
  // - updater-check-for-updates
  // - updater-start-download
  // - updater-quit-and-install

  /**
   * ⚠️ 重要：不要在此处自动触发 checkForUpdates。
   *
   * 根因说明（中文）：
   * - official 发行态下，initializeUpdateManager() 会在窗口创建之前被调用（见 app-lifecycle）。
   * - 如果这里自动检查更新，autoUpdater 的事件可能在 mainWindow 还没创建时触发，
   *   sendStatusToWindow() 会直接丢弃消息，导致前端“稳定不弹窗/偶发不弹窗”。
   *
   * 正确做法：
   * - 由渲染进程在“监听器已挂载”后发起 renderer-ready（IPC），
   *   主进程在 update-ipc.ts 中收到后再执行 checkForUpdates。
   */
}
