import fs from 'node:fs';

import { app } from 'electron';
import { requireFixtureAbsolutePath } from '../../harness/requireFixtureEnvironment';

import { createAppShutdownLifecycle } from '../../../../../src/electron-main/app-lifecycle/orchestration/createAppShutdownLifecycle';
import {
  configureMainWindowCloseLifecycle,
  createWindow,
  permitMainWindowCloseForAppShutdown,
} from '../../../../../src/electron-main/window-manager';

const resultPath = requireFixtureAbsolutePath('LINNYA_UPDATE_HANDOFF_RESULT_PATH');

function publish(value: unknown): void {
  const pendingPath = `${resultPath}.${process.pid}.pending`;
  fs.writeFileSync(pendingPath, JSON.stringify(value), 'utf8');
  fs.renameSync(pendingPath, resultPath);
}

void app.whenReady().then(async () => {
  const events: string[] = [];
  let windowId: number;
  const lifecycle = createAppShutdownLifecycle({
    prepareAppShutdown: async intent => {
      events.push(`prepare:${intent}`);
      return 'ready_to_quit';
    },
    commitWindowClosePermission: () => {
      events.push('window_close_committed');
      permitMainWindowCloseForAppShutdown();
    },
    requestElectronQuit: () => {
      throw new Error('install_update must not use the ordinary Electron quit port');
    },
    runShutdownStages: async () => {
      events.push('shutdown_stages');
    },
    drainDiagnosticLog: async () => {
      events.push('log_drain');
    },
    exitElectron: exitCode => {
      events.push(`unexpected_exit:${exitCode}`);
      app.exit(exitCode);
    },
    updateHandoff: {
      isReady: () => true,
      handoff() {
        events.push('update_handoff');
        publish({
          success: true,
          version: 1,
          events,
          handoffPhase: lifecycle.getPhase(),
          windowId,
        });
        // 模拟 electron-updater quitAndInstall 的 Electron quit 事件语义。
        app.quit();
      },
    },
  });

  configureMainWindowCloseLifecycle({
    hasExecutingCommands: () => false,
    requestShutdown: () => lifecycle.requestOrdinaryExit(),
    isWindowClosePermitted: () => lifecycle.isWindowClosePermitted(),
    canAcceptWindowRequests: () => lifecycle.canAcceptWindowRequest(),
  });
  const window = createWindow();
  if (!window) throw new Error('正式 window-manager 未创建测试窗口');
  windowId = window.id;
  window.on('close', event => {
    events.push(`window_close_prevented:${event.defaultPrevented}`);
  });
  window.on('closed', () => {
    events.push('window_closed');
  });

  app.on('before-quit', event => {
    events.push(`before-quit:${lifecycle.getPhase()}`);
    if (lifecycle.isWindowClosePermitted()) return;
    event.preventDefault();
  });
  app.on('will-quit', event => {
    events.push(`will-quit:${lifecycle.getPhase()}`);
    if (lifecycle.isUpdateHandoffInProgress()) {
      publish({
        success: true,
        version: 1,
        events,
        handoffPhase: lifecycle.getPhase(),
        windowId,
      });
      return;
    }
    event.preventDefault();
    void lifecycle.completeCommittedShutdown();
  });

  await lifecycle.requestInstallUpdate(() => events.push('update_committed'));
});
