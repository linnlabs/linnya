/**
 * @file src/electron-main/ipc/handlers/media-ipc.ts
 *
 * @brief 媒体文件相关的 IPC 处理器
 *
 * @description
 * 此模块处理所有与媒体文件（图片、音频）相关的 IPC 请求。
 * 从 file-handlers.js 中提取媒体领域的功能，使其成为独立的 handler。
 *
 * 核心职责:
 * - 图片选择和加载
 * - AI 生成图片的加载
 * - 音频文件的保存和加载
 * - 文件大小获取
 *
 * 设计原则:
 * - 单一职责: 仅处理媒体相关的 IPC
 * - 类型安全: 使用 TypeScript
 * - 依赖 mediaService: 调用服务层而非直接操作文件
 * - 统一错误处理: 所有错误都返回规范的结果对象
 */

import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import fs from 'fs/promises';
import {
  embedImageBytes,
  embedImageFile,
  loadImageAsDataUrl,
  saveAudioFile,
  loadAudioFileAsDataUrl,
} from '../../../services/mediaService.js';
import { MediaSourceWindowNotFoundError } from '../../../../features/system/media/definitions/mediaErrors.js';
import { createMediaOperationFailure } from './media-operation-failure.js';
import { issueReadGrantsFromDialogResult } from './file-read-grants';
import { assertReadablePath } from './media-path-rules';
import type { UserFacingMessage } from '@app/schemas';
import { createDialogDirectorySession } from '../../../../features/system/shared/dialog-directory/createDialogDirectorySession';

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
  locator?: string;
  dataUrl?: string;
  fileName?: string;
  fileSize?: number;
  size?: number;
  mtimeMs?: number;
  filePath?: string;
}

/**
 * 对话框结果
 */
interface DialogResult {
  canceled: boolean;
  filePaths?: string[];
  error?: string;
  userMessage?: UserFacingMessage;
}

interface SelectImageDialogOptions {
  title?: string;
  imageFilterName?: string;
}

interface EmbedImageBytesRequest {
  documentNodeId?: unknown;
  bytes?: unknown;
  ext?: unknown;
  fileName?: unknown;
}

interface PickAndEmbedImageRequest {
  documentNodeId?: unknown;
  title?: unknown;
  imageFilterName?: unknown;
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`[MediaIPC] ${fieldName} is required`);
  }
  return value.trim();
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value;
    const buffer = new ArrayBuffer(view.byteLength);
    const copy = new Uint8Array(buffer);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return buffer;
  }
  throw new Error('[MediaIPC] bytes must be an ArrayBuffer');
}

// ============================================================================
// 媒体处理 Handlers
// ============================================================================

/**
 * 注册媒体相关的 IPC 处理器
 */
export function registerMediaHandlers(): void {
  const mediaDialogDirectory = createDialogDirectorySession(app.getPath('pictures'));
  // ========================================================================
  // 图片操作
  // ========================================================================

  /**
   * 选择图片对话框
   */
  ipcMain.handle('select-image', async (event, options?: SelectImageDialogOptions): Promise<DialogResult> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      const failure = createMediaOperationFailure(
        new MediaSourceWindowNotFoundError(),
        'system.media.dialog.openFailed',
      );
      return {
        canceled: true,
        error: failure.error,
        userMessage: failure.userMessage,
      };
    }

    try {
      const result = await dialog.showOpenDialog(window, {
        title: options?.title || 'Select image',
        defaultPath: mediaDialogDirectory.currentDirectory(),
        filters: [{ name: options?.imageFilterName || 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] }],
        properties: ['openFile'],
      });

      await issueReadGrantsFromDialogResult(result);
      if (!result.canceled && result.filePaths[0]) {
        mediaDialogDirectory.rememberFile(result.filePaths[0]);
      }
      return result;
    } catch (error) {
      const failure = createMediaOperationFailure(error, 'system.media.dialog.openFailed');
      return {
        canceled: true,
        error: failure.error,
        userMessage: failure.userMessage,
      };
    }
  });

  ipcMain.handle('media:embed-image-bytes', async (_event, request?: EmbedImageBytesRequest): Promise<IpcResult> => {
    try {
      const documentNodeId = readRequiredString(request?.documentNodeId, 'documentNodeId');
      const extension = readRequiredString(request?.ext, 'ext');
      const bytes = normalizeArrayBuffer(request?.bytes);
      return await embedImageBytes({
        documentNodeId,
        imageDataBuffer: bytes,
        extension,
        fileName: readOptionalString(request?.fileName),
      });
    } catch (error) {
      console.error('[MediaIPC] 嵌入图片字节失败:', error);
      return createMediaOperationFailure(error, 'system.media.image.embedFailed');
    }
  });

  ipcMain.handle('media:pick-and-embed-image', async (event, request?: PickAndEmbedImageRequest): Promise<DialogResult & IpcResult> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      const failure = createMediaOperationFailure(
        new MediaSourceWindowNotFoundError(),
        'system.media.dialog.openFailed',
      );
      return {
        canceled: true,
        success: false,
        error: failure.error,
        userMessage: failure.userMessage,
      };
    }

    try {
      const documentNodeId = readRequiredString(request?.documentNodeId, 'documentNodeId');
      const result = await dialog.showOpenDialog(window, {
        title: readOptionalString(request?.title) || 'Select image',
        defaultPath: mediaDialogDirectory.currentDirectory(),
        filters: [{ name: readOptionalString(request?.imageFilterName) || 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'] }],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true, success: false };
      }

      await issueReadGrantsFromDialogResult(result);
      const sourcePath = result.filePaths[0];
      mediaDialogDirectory.rememberFile(sourcePath);
      const readablePath = await assertReadablePath(sourcePath, { operation: 'image' });
      const embedResult = await embedImageFile({
        documentNodeId,
        sourcePath: readablePath,
      });

      return {
        canceled: false,
        filePaths: [],
        ...embedResult,
      };
    } catch (error) {
      const failure = createMediaOperationFailure(error, 'system.media.image.embedFailed');
      return {
        canceled: true,
        success: false,
        error: failure.error,
        userMessage: failure.userMessage,
      };
    }
  });

  /**
   * 加载图片为 Data URL
   */
  ipcMain.handle('load-image-as-data-url', async (event, filePath: string): Promise<IpcResult> => {
    try {
      const readablePath = await assertReadablePath(filePath, { operation: 'image' });
      return await loadImageAsDataUrl(readablePath);
    } catch (error) {
      console.error(`[MediaIPC] 加载图片为 Data URL 失败 (${filePath}):`, error);
      return createMediaOperationFailure(error, 'system.media.image.loadFailed');
    }
  });

  ipcMain.handle('stat-image-file', async (event, filePath: string): Promise<IpcResult> => {
    try {
      const readablePath = await assertReadablePath(filePath, { operation: 'image' });
      const stats = await fs.stat(readablePath);
      return { success: true, size: stats.size, mtimeMs: stats.mtimeMs };
    } catch (error) {
      console.error(`[MediaIPC] 获取图片文件状态失败:`, error);
      return createMediaOperationFailure(error, 'system.media.image.statFailed');
    }
  });

  // ========================================================================
  // 音频操作
  // ========================================================================

  /**
   * 保存音频文件
   */
  ipcMain.handle('save-audio-file', async (event, audioDataBuffer: ArrayBuffer, clientMimeType?: string): Promise<IpcResult> => {
    try {
      return await saveAudioFile(audioDataBuffer, clientMimeType);
    } catch (error) {
      console.error('[MediaIPC] 保存音频文件失败:', error);
      return createMediaOperationFailure(error, 'system.media.audio.saveFailed');
    }
  });

  /**
   * 加载音频文件为 Data URL
   */
  ipcMain.handle('load-audio-file-as-data-url', async (event, filePath: string): Promise<IpcResult> => {
    try {
      const readablePath = await assertReadablePath(filePath, { operation: 'audio' });
      return await loadAudioFileAsDataUrl(readablePath);
    } catch (error) {
      console.error(`[MediaIPC] 加载音频文件为 Data URL 失败 (${filePath}):`, error);
      return createMediaOperationFailure(error, 'system.media.audio.loadFailed');
    }
  });

  // ========================================================================
  // 文件信息
  // ========================================================================

  /**
   * 获取文件大小
   */
  ipcMain.handle('get-file-size', async (event, filePath: string): Promise<IpcResult> => {
    try {
      const readablePath = await assertReadablePath(filePath, { operation: 'metadata' });
      const stats = await fs.stat(readablePath);
      return { success: true, size: stats.size };
    } catch (error) {
      console.error(`[MediaIPC] 获取文件大小失败:`, error);
      return createMediaOperationFailure(error, 'system.media.file.sizeFailed');
    }
  });

  console.log('[MediaIPC] 媒体相关 IPC 处理器已注册');
}
