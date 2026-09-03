/**
 * @file src/main/ipc/window-handlers.js
 * @description 处理所有与窗口控制和应用状态相关的IPC请求。
 */

import { ipcMain, BrowserWindow } from 'electron';

function registerWindowHandlers() {
  // === 窗口操作 ===
  ipcMain.on('window-action', (event, action) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      switch (action) {
        case 'minimize':
          window.minimize();
          break;
        case 'maximize':
          if (window.isMaximized()) {
            window.unmaximize();
          } else {
            window.maximize();
          }
          break;
        case 'close':
          window.close();
          break;
        default:
          console.warn(`[IPC处理] 未知的窗口操作: ${action}`);
          break;
      }
    }
  });

}

export { registerWindowHandlers };
