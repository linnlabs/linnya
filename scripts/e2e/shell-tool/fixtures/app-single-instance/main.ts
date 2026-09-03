import fs from 'node:fs';
import path from 'node:path';

import { app, BrowserWindow } from 'electron';

import { claimPrimaryAppInstance } from '../../../../../src/electron-main/app-instance';
import {
  createWindow,
  revealMainWindow,
  permitMainWindowCloseForAppShutdown,
} from '../../../../../src/electron-main/window-manager.js';

const runRoot = process.env.LINNYA_SINGLE_INSTANCE_RUN_ROOT;
if (!runRoot || !path.isAbsolute(runRoot)) {
  throw new Error('LINNYA_SINGLE_INSTANCE_RUN_ROOT must be an absolute path');
}

const eventLogPath = path.join(runRoot, 'events.log');
const writerPath = path.join(runRoot, 'primary-writers.log');
const stopPath = path.join(runRoot, 'stop');
const backendReadyPath = path.join(runRoot, 'backend-ready');
const runtimeIdentityPath = path.join(runRoot, 'runtime-identity.json');
app.setPath('userData', path.join(runRoot, 'user-data'));

function appendEvent(event: string): void {
  fs.appendFileSync(eventLogPath, `${Date.now()}\t${process.pid}\t${event}\n`, 'utf8');
}

const ownership = claimPrimaryAppInstance({
  app,
  revealPrimaryWindow: () => {
    revealMainWindow();
    appendEvent(`second-instance-window-count=${BrowserWindow.getAllWindows().length}`);
  },
});

if (ownership.status === 'primary') {
  void app.whenReady().then(() => {
    fs.writeFileSync(runtimeIdentityPath, JSON.stringify({
      platform: process.platform,
      architecture: process.arch,
      packaged: app.isPackaged,
      electron: process.versions.electron,
    }), 'utf8');
    fs.appendFileSync(writerPath, `${process.pid}\n`, 'utf8');
    appendEvent('primary-owner-ready');
    const startupPoll = setInterval(() => {
      if (!fs.existsSync(backendReadyPath)) return;
      clearInterval(startupPoll);
      // 生产 app-lifecycle 只有在数据库和 IPC 初始化完成后才调用首次 createWindow。
      createWindow();
      appendEvent('primary-ready');
      appendEvent(`primary-window-count=${BrowserWindow.getAllWindows().length}`);
    }, 25);
    const stopPoll = setInterval(() => {
      if (!fs.existsSync(stopPath)) return;
      clearInterval(stopPoll);
      appendEvent('primary-stopping');
      permitMainWindowCloseForAppShutdown();
      app.quit();
    }, 25);
  });
}
