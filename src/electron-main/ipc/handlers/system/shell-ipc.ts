/**
 * @file src/electron-main/ipc/handlers/shell-ipc.ts
 *
 * @brief Shell 操作相关的 IPC 处理器
 *
 * @description
 * 此模块处理所有与操作系统 Shell 交互相关的 IPC 请求。
 * 从 file-handlers.js 中提取 Shell 领域的功能，使其成为独立的 handler。
 *
 * 核心职责:
 * - 在文件管理器中显示文件
 * - 上下文菜单操作
 * - 其他系统级交互
 *
 * 设计原则:
 * - 单一职责: 仅处理 Shell 相关的 IPC
 * - 类型安全: 使用 TypeScript
 * - 跨平台兼容: 考虑不同操作系统的差异
 */

import { ipcMain, shell, Menu, BrowserWindow } from 'electron';
import type { UserFacingMessage } from '@app/schemas';
import {
  ShellExternalUrlInvalidError,
  ShellExternalUrlRequiredError,
  ShellExternalUrlUnsupportedProtocolError,
  ShellItemPathRequiredError,
} from '../../../../features/system/shell/definitions/shellErrors';
import { createShellOperationFailure } from './shell-operation-failure';
import { assertReadablePath } from './media-path-rules';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * IPC 处理结果
 */
interface IpcResult {
  success: boolean;
  error?: string;
  userMessage?: UserFacingMessage;
}

// ============================================================================
// Shell 操作 Handlers
// ============================================================================

/**
 * 注册 Shell 相关的 IPC 处理器
 */
export function registerShellHandlers(): void {
  /**
   * 使用系统默认浏览器打开外部链接
   *
   * 中文说明：
   * - 这是“打开原网页/打开链接”的统一入口，避免渲染进程直接 window.open 导致在 Electron 内部开窗加载远程页面；
   * - 仅允许 http/https，防止 file://、javascript: 等协议被滥用。
   */
  ipcMain.handle('open-external-url', async (_event, url: string): Promise<IpcResult> => {
    try {
      if (typeof url !== 'string' || url.trim().length === 0) {
        return createShellOperationFailure(
          new ShellExternalUrlRequiredError(),
          'system.shell.external.openFailed',
        );
      }

      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return createShellOperationFailure(
          new ShellExternalUrlInvalidError(url),
          'system.shell.external.openFailed',
        );
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return createShellOperationFailure(
          new ShellExternalUrlUnsupportedProtocolError(parsed.protocol),
          'system.shell.external.openFailed',
        );
      }

      await shell.openExternal(parsed.toString());
      return { success: true };
    } catch (error) {
      console.error('[ShellIPC] 打开外部链接失败:', error);
      return createShellOperationFailure(error, 'system.shell.external.openFailed');
    }
  });

  /**
   * 在文件管理器中显示文件
   */
  ipcMain.handle('show-item-in-folder', async (event, filePath: string): Promise<IpcResult> => {
    try {
      if (typeof filePath !== 'string' || filePath.trim().length === 0) {
        return createShellOperationFailure(
          new ShellItemPathRequiredError(),
          'system.shell.item.showInFolderFailed',
        );
      }
      const readablePath = await assertReadablePath(filePath, { operation: 'show' });
      shell.showItemInFolder(readablePath);
      return { success: true };
    } catch (error) {
      console.error(`[ShellIPC] 在文件管理器中显示项目失败:`, error);
      return createShellOperationFailure(error, 'system.shell.item.showInFolderFailed');
    }
  });

  /**
   * 显示文件/文件夹上下文菜单
   */
  ipcMain.on('show-item-context-menu', (event, itemPath: string, itemType: 'file' | 'folder') => {
    console.log(`[ShellIPC] 收到显示上下文菜单请求: ${itemPath} (类型: ${itemType})`);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;

    const template = [
      {
        label: '重命名',
        click: () => {
          console.log(`[ShellIPC] 点击重命名: ${itemPath}. 发送trigger-rename事件`);
          event.sender.send('trigger-rename', itemPath);
        },
      },
      {
        label: '删除',
        click: () => {
          console.log(`[ShellIPC] 点击删除: ${itemPath}. 发送trigger-delete事件`);
          event.sender.send('trigger-delete', itemPath);
        },
      },
      // 可添加更多菜单项
      // { type: 'separator' },
      // { label: '在文件管理器中显示' }
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window });
  });

  console.log('[ShellIPC] Shell 相关 IPC 处理器已注册');
}
