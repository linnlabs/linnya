/**
 * 后台服务状态的 IPC：读取快照、用户要求重新启动、打开日志文件夹。
 * 状态由 Main 的 AppServerHealthController 唯一持有，这里只转发。
 */

import { ipcMain, shell } from 'electron';
import {
  APP_SERVER_HEALTH_GET_STATE_CHANNEL,
  APP_SERVER_HEALTH_OPEN_LOG_FOLDER_CHANNEL,
  APP_SERVER_HEALTH_RESTART_CHANNEL,
} from '../../../../shared/app-server-health/definitions/appServerHealthMessage';
import { getAppServerHealthController } from '../../../app-server-health/orchestration/initializeAppServerHealth';
import { getLogDirectory } from '../../../../shared/utils/pathManager';

export function registerAppServerHealthHandlers(): void {
  ipcMain.handle(APP_SERVER_HEALTH_GET_STATE_CHANNEL, () => getAppServerHealthController().getState());
  ipcMain.handle(APP_SERVER_HEALTH_RESTART_CHANNEL, () => {
    getAppServerHealthController().restart();
  });
  ipcMain.handle(APP_SERVER_HEALTH_OPEN_LOG_FOLDER_CHANNEL, async () => {
    const failure = await shell.openPath(getLogDirectory());
    if (failure) throw new Error(failure);
  });
}
