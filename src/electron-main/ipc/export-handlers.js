/**
 * @file src/main/ipc/export-handlers.js
 * @description 处理所有与文件导出相关的IPC请求。
 */

import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import {
  ExportDirectoryPathRequiredError,
  ExportDirectoryNotAuthorizedError,
  ExportFocusedWindowMissingError,
  ExportInvalidPayloadError,
  ExportSourceWindowMissingError,
} from '../../features/system/export/definitions/exportErrors.ts';
import { createExportOperationFailure } from './handlers/system/export-operation-failure.ts';
import {
  assertPathInsideDirectory,
  normalizeExportDirectoryPath,
  resolveUniqueExportFilePath,
  validateBatchExportFiles,
} from './handlers/system/export-path-rules.ts';
import { issueReadGrantsFromDialogResult } from './handlers/system/file-read-grants.ts';
import { createDialogDirectorySession } from '../../features/system/shared/dialog-directory/createDialogDirectorySession.ts';
import { normalizeExportArtifactRequest } from '../../features/system/export/functions/exportArtifactRules.ts';
import { authorizeExportArtifactTarget } from '../../features/system/export/orchestration/exportArtifactTargetRuntime.ts';
import { electronPdfDocumentRuntime } from '../desktop-capabilities/pdf-document/index.ts';

const authorizedExportDirectoryRealPaths = new Set();

function failureResult(error, fallbackKey) {
  return createExportOperationFailure(error, fallbackKey);
}

function readDialogLabel(options, key, fallback) {
  if (options && typeof options === 'object' && typeof options[key] === 'string' && options[key].trim().length > 0) {
    return options[key];
  }
  return fallback;
}

async function authorizeSelectedExportDirectories(dialogResult) {
  if (!dialogResult || dialogResult.canceled || !Array.isArray(dialogResult.filePaths)) {
    return;
  }

  for (const selectedPath of dialogResult.filePaths) {
    if (typeof selectedPath !== 'string' || selectedPath.trim().length === 0) {
      continue;
    }
    const normalizedPath = normalizeExportDirectoryPath(selectedPath);
    const realPath = await fs.realpath(normalizedPath);
    authorizedExportDirectoryRealPaths.add(realPath);
  }
}

function assertDirectoryAuthorized(directoryRealPath) {
  if (!authorizedExportDirectoryRealPaths.has(directoryRealPath)) {
    throw new ExportDirectoryNotAuthorizedError(directoryRealPath);
  }
}

function registerExportHandlers() {
  const fileDialogDirectory = createDialogDirectorySession(app.getPath('documents'));
  const exportDialogDirectory = createDialogDirectorySession(app.getPath('documents'));
  // === 导出功能 ===

  // ============================================================================
  // 通用文件对话框（preload 中已暴露 openFileDialog / openDirectoryDialog）
  // ============================================================================

  /**
   * 打开“选择文件”对话框
   * @param {unknown} options - showOpenDialog 的 options（由渲染进程传入）
   */
  ipcMain.handle('open-file-dialog', async (event, options) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
    try {
      const safeOptions = typeof options === 'object' && options ? options : {};
      // 允许业务侧自定义 filters / properties / title 等
      const dialogResult = await dialog.showOpenDialog(parentWindow, {
        defaultPath: fileDialogDirectory.currentDirectory(),
        ...safeOptions,
      });
      await issueReadGrantsFromDialogResult(dialogResult);
      if (!dialogResult.canceled && dialogResult.filePaths[0]) {
        fileDialogDirectory.rememberFile(dialogResult.filePaths[0]);
      }
      return { success: true, data: dialogResult };
    } catch (error) {
      console.error('[open-file-dialog] 打开对话框失败:', error);
      return failureResult(error, 'system.export.dialog.openFileFailed');
    }
  });

  /**
   * 打开“选择文件夹”对话框
   * @param {unknown} options - showOpenDialog 的 options（由渲染进程传入）
   */
  ipcMain.handle('open-directory-dialog', async (event, options) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
    try {
      const safeOptions = typeof options === 'object' && options ? options : {};
      // 确保是“选择目录”场景
      const mergedOptions = {
        title: 'Choose export folder',
        defaultPath: exportDialogDirectory.currentDirectory(),
        ...safeOptions,
        properties: ['openDirectory', 'createDirectory'],
      };
      const dialogResult = await dialog.showOpenDialog(parentWindow, mergedOptions);
      await authorizeSelectedExportDirectories(dialogResult);
      if (!dialogResult.canceled && dialogResult.filePaths[0]) {
        exportDialogDirectory.rememberDirectory(dialogResult.filePaths[0]);
      }
      return { success: true, data: dialogResult };
    } catch (error) {
      console.error('[open-directory-dialog] 打开对话框失败:', error);
      return failureResult(error, 'system.export.dialog.openDirectoryFailed');
    }
  });

  // 插件只取得一次性 opaque token；真实保存路径始终留在 Host main process。
  ipcMain.handle('export-artifact:request-target', async (event, payload) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!parentWindow) {
      throw new ExportSourceWindowMissingError('export-artifact:request-target');
    }
    const request = normalizeExportArtifactRequest(payload);
    const dialogResult = await dialog.showSaveDialog(parentWindow, {
      title: request.labels.title,
      defaultPath: exportDialogDirectory.resolveFileDefaultPath(request.suggestedFileName),
      buttonLabel: request.labels.buttonLabel,
      filters: [{ name: request.labels.filterName, extensions: [request.extension] }],
    });
    if (dialogResult.canceled || !dialogResult.filePath) {
      return { status: 'cancelled' };
    }
    const target = authorizeExportArtifactTarget(request, dialogResult.filePath);
    exportDialogDirectory.rememberFile(dialogResult.filePath);
    return { status: 'authorized', target };
  });
  
  // 导出TXT文件
  ipcMain.handle('export-file', async (event, defaultFileName, content, fileType) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (!focusedWindow) {
      console.error('导出失败: 无焦点窗口');
      return failureResult(new ExportFocusedWindowMissingError('export-file'), 'system.export.file.saveFailed');
    }

    try {
      const options = typeof fileType === 'object' && fileType ? fileType : {};
      const resolvedFileType = typeof fileType === 'string' ? fileType : options.fileType;
      let dialogOptions;
      if (resolvedFileType === 'md') {
        dialogOptions = {
          title: readDialogLabel(options, 'title', 'Export as Markdown'),
          defaultPath: exportDialogDirectory.resolveFileDefaultPath(defaultFileName),
          buttonLabel: readDialogLabel(options, 'buttonLabel', 'Export'),
          filters: [{ name: readDialogLabel(options, 'filterName', 'Markdown Files'), extensions: ['md'] }]
        };
      } else if (resolvedFileType === 'json') {
        dialogOptions = {
          title: readDialogLabel(options, 'title', 'Export JSON'),
          defaultPath: exportDialogDirectory.resolveFileDefaultPath(defaultFileName),
          buttonLabel: readDialogLabel(options, 'buttonLabel', 'Export'),
          filters: [{ name: readDialogLabel(options, 'filterName', 'JSON Files'), extensions: ['json'] }]
        };
      } else { // 默认为 txt
        dialogOptions = {
          title: readDialogLabel(options, 'title', 'Export as TXT'),
          defaultPath: exportDialogDirectory.resolveFileDefaultPath(defaultFileName),
          buttonLabel: readDialogLabel(options, 'buttonLabel', 'Export'),
          filters: [{ name: readDialogLabel(options, 'filterName', 'Text Files'), extensions: ['txt'] }]
        };
      }
      
      const dialogResult = await dialog.showSaveDialog(focusedWindow, dialogOptions);

      if (dialogResult.canceled || !dialogResult.filePath) {
        console.log('导出被用户取消');
        return { success: false, cancelled: true };
      }

      await fs.writeFile(dialogResult.filePath, content, 'utf8');
      exportDialogDirectory.rememberFile(dialogResult.filePath);
      console.log(`文件成功导出到: ${dialogResult.filePath}`);
      return { success: true, filePath: dialogResult.filePath };

    } catch (error) {
      console.error('导出文件错误:', error);
      return failureResult(error, 'system.export.file.saveFailed');
    }
  });

  // 导出PDF文件
  ipcMain.handle('export-pdf', async (event, defaultFileName, htmlContent) => {
    // 获取原始窗口，主要用于显示对话框
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!parentWindow) {
      console.error('导出PDF失败: 无法找到源窗口');
      return failureResult(new ExportSourceWindowMissingError('export-pdf'), 'system.export.pdf.saveFailed');
    }

    // 弹出保存对话框
    try {
      const options = typeof htmlContent === 'object' && htmlContent ? htmlContent : {};
      const resolvedHtmlContent = typeof htmlContent === 'string' ? htmlContent : options.htmlContent;
      const dialogResult = await dialog.showSaveDialog(parentWindow, {
        title: readDialogLabel(options, 'title', 'Export as PDF'),
        defaultPath: exportDialogDirectory.resolveFileDefaultPath(defaultFileName),
        buttonLabel: readDialogLabel(options, 'buttonLabel', 'Export'),
        filters: [{ name: readDialogLabel(options, 'filterName', 'PDF Files'), extensions: ['pdf'] }]
      });

      if (dialogResult.canceled || !dialogResult.filePath) {
        console.log('PDF导出被用户取消');
        return { success: false, cancelled: true };
      }

      if (typeof resolvedHtmlContent !== 'string') {
        throw new ExportInvalidPayloadError('export-pdf');
      }
      const pdfData = await electronPdfDocumentRuntime.renderHtml(resolvedHtmlContent);
      await fs.writeFile(dialogResult.filePath, pdfData);
      exportDialogDirectory.rememberFile(dialogResult.filePath);
      console.log(`PDF成功导出到: ${dialogResult.filePath}`);
      return { success: true, filePath: dialogResult.filePath };

    } catch (error) {
      console.error('导出PDF错误:', error);
      return failureResult(error, 'system.export.pdf.saveFailed');
    }
  });

  // ============================================================================
  // 批量导出：一次选择目录，主进程负责批量写文件并处理重名
  // ============================================================================

  /**
   * 批量导出文件到指定目录
   * @param {unknown} payload
   * payload: { directoryPath: string, files: Array<{ fileName: string, content: string }> }
   */
  ipcMain.handle('export-files-to-directory', async (_event, payload) => {
    try {
      if (!payload || typeof payload !== 'object') {
        throw new ExportInvalidPayloadError('export-files-to-directory');
      }

      const { directoryPath, files } = payload;

      if (typeof directoryPath !== 'string' || directoryPath.trim().length === 0) {
        throw new ExportDirectoryPathRequiredError();
      }

      const validatedFiles = validateBatchExportFiles(files);
      const normalizedDirectoryPath = normalizeExportDirectoryPath(directoryPath);

      // 过渡期仍保留旧签名，但写入目录必须来自本会话 open-directory-dialog 的真实选择结果。
      const directoryRealPath = await fs.realpath(normalizedDirectoryPath);
      assertDirectoryAuthorized(directoryRealPath);

      const usedNamesSet = new Set();
      const written = [];

      for (const file of validatedFiles) {
        const targetPath = await resolveUniqueExportFilePath({
          directoryRealPath,
          desiredFileName: file.fileName,
          usedNamesSet,
        });
        const parentRealPath = await fs.realpath(path.dirname(targetPath));
        assertPathInsideDirectory(parentRealPath, directoryRealPath);
        await fs.writeFile(targetPath, file.content, { encoding: 'utf8', flag: 'wx' });
        written.push(targetPath);
      }

      return { success: true, data: { writtenPaths: written } };
    } catch (error) {
      console.error('[export-files-to-directory] 批量导出失败:', error);
      return failureResult(error, 'system.export.batch.writeFailed');
    }
  });
}

export { registerExportHandlers };
