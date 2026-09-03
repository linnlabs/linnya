/**
 * @file src/electron-main/ipc/handlers/update-ipc.ts
 *
 * @brief 应用更新相关的 IPC 处理器
 *
 * @description
 * 此模块处理所有与应用更新和初始化相关的 IPC 请求。
 * 从 file-handlers.js 中提取更新领域的功能，使其成为独立的 handler。
 *
 * 核心职责:
 * - 渲染进程准备就绪的信号处理
 * - 触发自动更新检查
 * - 返回应用初始状态
 * - 响应渲染进程的更新操作请求（检查、下载、安装）
 *
 * 设计原则:
 * - 单一职责: 仅处理更新和初始化相关的 IPC
 * - 类型安全: 使用 TypeScript
 * - 依赖 store: 从持久化存储获取初始数据
 */

import { ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import { store } from '../../../store/index.js';
import { getMainWindow } from '../../../window-manager.js';
import { Logger } from '../../../../shared/logger.js';
import type {
  UpdateMessageChannel,
  UpdateMessagePayload,
} from '../../../../shared/update/definitions/updateMessage';
import { publishRendererReady } from '../../../events/rendererReadyEvent';
import { installDownloadedUpdate } from '../../../update/orchestration/installDownloadedUpdate';

const logger = new Logger('update-ipc');

function log(message: string, ...args: unknown[]) {
  logger.info(message, ...args);
}

function logError(message: string, ...args: unknown[]) {
  logger.error(message, ...args);
}

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 渲染进程准备就绪的结果
 */
interface RendererReadyResult {
  success: boolean;
  data?: unknown[];
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * @description 向渲染进程发送状态更新。
 * @param {string} channel - 事件通道名（由 electron-updater 事件映射而来）
 * @param {unknown} [payload] - 事件载荷（结构由 electron-updater 决定）
 */
function sendStatusToWindow(channel: UpdateMessageChannel, payload?: UpdateMessagePayload) {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send('update-message', { channel, payload });
  } else {
    console.warn(`[update-ipc] Cannot send status to window, mainWindow is not available. Channel: ${channel}`);
    logger.warn(`Cannot send status to window, mainWindow is not available. Channel: ${channel}`);
  }
}

function shouldSkipAppUpdateChecks(): boolean {
  return process.env.LINNYA_DISABLE_UPDATE_CHECKS === '1';
}

// ============================================================================
// 更新与初始化 Handlers
// ============================================================================

/**
 * 注册更新相关的 IPC 处理器
 */
export function registerUpdateHandlers(): void {
  /**
   * 监听渲染进程已准备好的信号
   */
  ipcMain.handle('renderer-ready', async (event): Promise<RendererReadyResult> => {
    // renderer-ready 是应用生命周期事件；具体业务同步由各自 domain / service 订阅处理。
    const rendererReadyListenerCount = publishRendererReady(event.sender);
    if (rendererReadyListenerCount === 0) {
      logger.warn('renderer-ready 事件暂无订阅者，依赖该生命周期信号的后台同步可能不会触发。');
    }

    /**
     * 触发更新检查（稳定性保证）
     *
     * 设计要点（中文）：
     * - 只有当渲染进程已完成“update-message 监听器注册”后，才触发 checkForUpdates；
     * - 这样可避免主进程过早发送 update-message 而导致前端漏收，进而“不弹窗”的问题。
     */
    if (shouldSkipAppUpdateChecks()) {
      // 中文：Electron 自动化 smoke 需要稳定截图；应用更新弹窗是独立能力，不应污染页面视觉验收。
      log('跳过更新检查：LINNYA_DISABLE_UPDATE_CHECKS=1');
    } else {
      try {
        // 这里不强制等待结果，electron-updater 会通过事件推送进度与结果。
        // 但我们仍 catch 一下，确保异常能回传到前端弹窗（error 也需要弹）。
        await autoUpdater.checkForUpdates();
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to check for updates';
        logError('renderer-ready 触发更新检查失败:', err);
        sendStatusToWindow('error', errorMessage);
      }
    }

    // 返回初始状态（例如，最近的文件列表）
    const storedRecentFiles = store.get('recentFiles');
    const recentFiles = Array.isArray(storedRecentFiles) ? storedRecentFiles : [];
    return { success: true, data: recentFiles };
  });

  /**
   * 响应渲染进程的检查更新请求
   */
  ipcMain.handle('updater-check-for-updates', () => {
    if (shouldSkipAppUpdateChecks()) {
      log('IPC: 已跳过 updater-check-for-updates：LINNYA_DISABLE_UPDATE_CHECKS=1');
      return null;
    }

    log('IPC: 收到 updater-check-for-updates 请求，开始检查更新...');
    try {
      return autoUpdater.checkForUpdates();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to check for updates';
      logError('updater-check-for-updates 出错:', err);
      sendStatusToWindow('error', errorMessage);
      return null;
    }
  });

  /**
   * 响应渲染进程的开始下载请求
   */
  ipcMain.handle('updater-start-download', async () => {
    log('IPC: 收到 updater-start-download 请求，开始下载...');
    try {
      const result = await autoUpdater.downloadUpdate();
      log('下载成功，结果:', result);
      return result;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start download';
      logError('updater-start-download 出错:', err);
      sendStatusToWindow('error', errorMessage);
      return null;
    }
  });

  /**
   * 响应渲染进程的退出并安装请求
   */
  ipcMain.handle('updater-quit-and-install', () => {
    log('IPC: 收到 updater-quit-and-install 请求，准备退出并安装...');
    try {
      return installDownloadedUpdate({
        source: 'updater-quit-and-install-ipc',
        sendStatus: sendStatusToWindow,
        log,
        logError,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to quit and install';
      logError('updater-quit-and-install 出错:', err);
      sendStatusToWindow('error', errorMessage);
      return { success: false, alreadyRequested: false };
    }
  });

  log('更新相关 IPC 处理器已注册');
}
