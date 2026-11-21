import { Logger } from '../../../shared/logger.js';
import { APP_SERVER_HEALTH_STATE_CHANNEL } from '../../../shared/app-server-health/definitions/appServerHealthMessage';
import { store } from '../../store/index.js';
import { getMainWindow } from '../../window-manager.js';
import { type AppServerHealthController, createAppServerHealthController } from './createAppServerHealthController';

const CRASH_HISTORY_KEY = 'appServerHealth.crashTimestamps';
const RECOVERED_NOTICE_KEY = 'appServerHealth.recoveredNotice';
const logger = new Logger('app-server-health');

let controller: AppServerHealthController | undefined;

export function getAppServerHealthController(): AppServerHealthController {
  if (!controller) throw new Error('后台服务状态尚未初始化');
  return controller;
}

export interface InitializeAppServerHealthOptions {
  readonly ping: () => Promise<void>;
  /** 当前 App Server 进程；未启动或已退出时返回 undefined。 */
  readonly readAppServerPid: () => number | undefined;
  /** 关闭并重新打开应用；由 App owner 决定自己重开还是交给启动器。 */
  readonly relaunchApp: () => void;
}

export function initializeAppServerHealth(options: InitializeAppServerHealthOptions): AppServerHealthController {
  if (controller) return controller;
  controller = createAppServerHealthController({
    ping: options.ping,
    isAppServerAlive: () => options.readAppServerPid() !== undefined,
    killAppServer: () => {
      const pid = options.readAppServerPid();
      if (pid === undefined) return;
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        logger.warn('结束无响应的后台服务失败', error);
      }
    },
    relaunchApp: () => {
      logger.info('重新启动应用以恢复后台服务');
      options.relaunchApp();
    },
    crashHistory: {
      read: () => {
        const value: unknown = store.get(CRASH_HISTORY_KEY);
        return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : [];
      },
      write: history => {
        if (history.length === 0) store.delete(CRASH_HISTORY_KEY);
        else store.set(CRASH_HISTORY_KEY, [...history]);
      },
    },
    recoveredNotice: {
      take: () => {
        const value = store.get(RECOVERED_NOTICE_KEY) === true;
        if (value) store.delete(RECOVERED_NOTICE_KEY);
        return value;
      },
      set: () => store.set(RECOVERED_NOTICE_KEY, true),
    },
    publish: state => {
      const window = getMainWindow();
      if (window && !window.isDestroyed()) window.webContents.send(APP_SERVER_HEALTH_STATE_CHANNEL, state);
    },
    timers: {
      now: () => Date.now(),
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs).unref(),
      clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
    },
    log: (message, details) => logger.info(message, details ?? {}),
  });
  return controller;
}
