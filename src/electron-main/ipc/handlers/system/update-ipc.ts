/**
 * @file src/electron-main/ipc/handlers/system/update-ipc.ts
 *
 * @brief 应用更新与 renderer-ready 的 IPC 处理器
 *
 * 更新状态由 Main 的 AppUpdateController 唯一持有；这里只做通道到 controller 的转发和入参校验。
 * renderer-ready 表示页面已经挂好监听，此时才开始后台检查，避免状态推送早于监听。
 */

import { ipcMain } from 'electron';
import { store } from '../../../store/index.js';
import { Logger } from '../../../../shared/logger.js';
import {
  APP_UPDATE_ACKNOWLEDGE_INSTALLED_CHANNEL,
  APP_UPDATE_CANCEL_DOWNLOAD_CHANNEL,
  APP_UPDATE_CHECK_CHANNEL,
  APP_UPDATE_DOWNLOAD_CHANNEL,
  APP_UPDATE_GET_STATE_CHANNEL,
  APP_UPDATE_INSTALL_CHANNEL,
  isAppUpdateInstallRequest,
} from '../../../../shared/update/definitions/updateMessage';
import { publishRendererReady } from '../../../events/rendererReadyEvent';
import { getAppUpdateController } from '../../../update/orchestration/initializeAppUpdates';

const logger = new Logger('update-ipc');

interface RendererReadyResult {
  success: boolean;
  data?: unknown[];
}

export function registerUpdateHandlers(): void {
  ipcMain.handle('renderer-ready', async (event): Promise<RendererReadyResult> => {
    // renderer-ready 是应用生命周期事件；具体业务同步由各自 domain / service 订阅处理。
    const rendererReadyListenerCount = publishRendererReady(event.sender);
    if (rendererReadyListenerCount === 0) {
      logger.warn('renderer-ready 事件暂无订阅者，依赖该生命周期信号的后台同步可能不会触发。');
    }
    getAppUpdateController().start();

    const storedRecentFiles = store.get('recentFiles');
    const recentFiles = Array.isArray(storedRecentFiles) ? storedRecentFiles : [];
    return { success: true, data: recentFiles };
  });

  ipcMain.handle(APP_UPDATE_GET_STATE_CHANNEL, () => getAppUpdateController().getState());
  ipcMain.handle(APP_UPDATE_CHECK_CHANNEL, () => getAppUpdateController().check());
  ipcMain.handle(APP_UPDATE_DOWNLOAD_CHANNEL, async () => {
    await getAppUpdateController().download();
  });
  ipcMain.handle(APP_UPDATE_CANCEL_DOWNLOAD_CHANNEL, () => {
    getAppUpdateController().cancelDownload();
  });
  ipcMain.handle(APP_UPDATE_INSTALL_CHANNEL, (_event, request: unknown) => {
    if (!isAppUpdateInstallRequest(request)) throw new Error('更新安装请求格式无效');
    return getAppUpdateController().install(request);
  });
  ipcMain.handle(APP_UPDATE_ACKNOWLEDGE_INSTALLED_CHANNEL, () => {
    getAppUpdateController().acknowledgeInstalled();
  });

  logger.info('更新相关 IPC 处理器已注册');
}
