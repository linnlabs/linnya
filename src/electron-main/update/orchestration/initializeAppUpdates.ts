import { app } from 'electron';

import { Logger } from '../../../shared/logger.js';
import type { DistributionIdentity } from '../../../shared/distribution-identity';
import type { AppShutdownRequestOutcome } from '../../app-lifecycle/definitions/appShutdownLifecycle';
import { APP_UPDATE_STATE_CHANNEL } from '../../../shared/update/definitions/updateMessage';
import { store } from '../../store/index.js';
import { getMainWindow } from '../../window-manager.js';
import type { AppUpdateActivityPort } from '../definitions/appUpdatePorts';
import { shouldCheckForAppUpdates } from '../functions/shouldCheckForAppUpdates';
import { type AppUpdateController, createAppUpdateController } from './createAppUpdateController';
import { createElectronAppUpdaterPort } from './createElectronAppUpdaterPort';
import { setDownloadedUpdateReady } from './electronUpdaterHandoff';

const PENDING_INSTALL_KEY = 'appUpdate.pendingInstallVersion';
const logger = new Logger('app-update');

export interface InitializeAppUpdatesOptions {
  readonly distributionIdentity: DistributionIdentity;
  /** App owner 启动时解析的产品版本；开发态 app.getVersion() 是 Electron 版本，不能用。 */
  readonly currentVersion: string;
  /** Backend 启动前后都可能被调用；未就绪时返回 undefined，按没有任务处理。 */
  readonly readActivityPort: () => AppUpdateActivityPort | undefined;
  readonly requestInstall: () => Promise<AppShutdownRequestOutcome>;
}

let controller: AppUpdateController | undefined;

export function getAppUpdateController(): AppUpdateController {
  if (!controller) throw new Error('应用更新尚未初始化');
  return controller;
}

/** 只有验签通过的官方发行版才连接正式更新源；其他发行版仍提供 disabled 状态供 Renderer 读取。 */
export function initializeAppUpdates(options: InitializeAppUpdatesOptions): AppUpdateController {
  if (controller) return controller;
  const enabled = shouldCheckForAppUpdates(options.distributionIdentity, {
    LINNYA_DISABLE_UPDATE_CHECKS: process.env.LINNYA_DISABLE_UPDATE_CHECKS,
  });
  if (enabled) {
    // 官方包由 electron-builder 的发布配置提供 feed；不让环境里的 GitHub token 改变更新源行为。
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
  } else {
    logger.info(`disabled for ${options.distributionIdentity.kind} distribution`);
  }

  controller = createAppUpdateController({
    enabled,
    currentVersion: options.currentVersion,
    updater: enabled ? createElectronAppUpdaterPort() : {
      checkForUpdates: async () => null,
      downloadUpdate: async () => {},
      createCancellation: () => ({ cancel() {} }),
      onDownloadProgress: () => {},
    },
    activity: {
      async read() {
        const port = options.readActivityPort();
        return port
          ? port.read()
          : { hasExecutingCommands: false, activeAgentRuns: [], knowledgeIngestionActive: false };
      },
      async pauseAgentRuns() {
        return options.readActivityPort()?.pauseAgentRuns();
      },
    },
    isInstallLocationSupported: () => (
      process.platform !== 'darwin' || app.isInApplicationsFolder()
    ),
    setDownloadedUpdateReady,
    requestInstall: options.requestInstall,
    pendingInstall: {
      read: () => {
        const value = store.get(PENDING_INSTALL_KEY);
        return typeof value === 'string' ? value : null;
      },
      write: value => {
        if (value === null) store.delete(PENDING_INSTALL_KEY);
        else store.set(PENDING_INSTALL_KEY, value);
      },
    },
    publish: state => {
      const window = getMainWindow();
      if (window && !window.isDestroyed()) window.webContents.send(APP_UPDATE_STATE_CHANNEL, state);
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
