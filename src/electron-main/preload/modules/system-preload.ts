/**
 * @file src/electron-main/preload/modules/system-preload.ts
 *
 * @description
 * 系统能力相关的 preload API：
 * - 窗口控制 / 更新消息监听 / 端口通知
 * - 媒体加载、文件导出、文件大小等
 * - 任务状态、转录进度监听
 *
 * 窗口关闭协议只暴露保存准备结果，真正的 App/命令 owner 收口留在 Electron main。
 */

import type { IpcRenderer, IpcRendererEvent } from 'electron';
import type { UpdateStatusMessage } from '../../../shared/update/definitions/updateMessage';
import type { ExportArtifactTargetRequest } from '@linnya/plugin-host-contract/renderer/exportArtifact';
import {
  WINDOW_CLOSE_PREPARATION_RESULT_CHANNEL,
  WINDOW_CLOSE_RENDERER_READY_CHANNEL,
  WINDOW_CLOSE_REQUEST_CHANNEL,
  WindowCloseRendererSessionIdSchema,
  WindowCloseRequestMessageSchema,
  type WindowClosePreparationResult,
  type WindowCloseRequestId,
  type WindowCloseRequestMessage,
} from '../../../shared/app-lifecycle/definitions/windowCloseProtocol';
import {
  WINDOW_FOCUS_STATE_CHANNEL,
  WindowFocusStateMessageSchema,
} from '../../../shared/app-lifecycle/definitions/windowFocusProtocol';

type WindowFocusIpcListener = (_event: unknown, value: unknown) => void;

interface WindowFocusIpcPort {
  on(channel: typeof WINDOW_FOCUS_STATE_CHANNEL, listener: WindowFocusIpcListener): unknown;
  removeListener(channel: typeof WINDOW_FOCUS_STATE_CHANNEL, listener: WindowFocusIpcListener): unknown;
}

export const subscribeWindowFocusState = (
  ipcRenderer: WindowFocusIpcPort,
  callback: (focused: boolean) => void,
): (() => void) => {
  const listener: WindowFocusIpcListener = (_event, value) => {
    const parsed = WindowFocusStateMessageSchema.safeParse(value);
    if (!parsed.success) return;
    callback(parsed.data.focused);
  };
  ipcRenderer.on(WINDOW_FOCUS_STATE_CHANNEL, listener);
  return () => {
    ipcRenderer.removeListener(WINDOW_FOCUS_STATE_CHANNEL, listener);
  };
};

export function buildSystemPreloadApi(ipcRenderer: IpcRenderer) {
  // preload 每次 document 生命周期只生成一次。主进程用它区分同一 WebContents 导航前后的页面。
  const rendererSessionId = WindowCloseRendererSessionIdSchema.parse(globalThis.crypto.randomUUID());

  return {
    /**
     * 监听窗口关闭请求事件
     * @param callback 当需要关闭窗口时调用的回调函数
     * @returns 移除监听器的函数
     */
    onWindowCloseRequest: (callback: (request: WindowCloseRequestMessage) => void) => {
      const listener = (_event: IpcRendererEvent, value: unknown) => {
        const parsed = WindowCloseRequestMessageSchema.safeParse(value);
        if (!parsed.success || parsed.data.renderer_session_id !== rendererSessionId) return;
        callback(parsed.data);
      };
      ipcRenderer.on(WINDOW_CLOSE_REQUEST_CHANNEL, listener);
      return () => {
        ipcRenderer.removeListener(WINDOW_CLOSE_REQUEST_CHANNEL, listener);
      };
    },

    markWindowCloseRendererReady: () => {
      ipcRenderer.send(WINDOW_CLOSE_RENDERER_READY_CHANNEL, {
        schema_version: 1,
        kind: 'window_close_renderer_ready',
        renderer_session_id: rendererSessionId,
      });
    },

    /** 保存成功才允许主进程继续退出；失败必须保留窗口，让用户修复后重试。 */
    completeWindowClosePreparation: (
      requestId: WindowCloseRequestId,
      result: WindowClosePreparationResult,
    ) => {
      ipcRenderer.send(WINDOW_CLOSE_PREPARATION_RESULT_CHANNEL, {
        schema_version: 1,
        kind: 'window_close_preparation_result',
        renderer_session_id: rendererSessionId,
        request_id: requestId,
        result,
      });
    },

    // --- 应用更新 ---
    onUpdateMessage: (callback: (message: UpdateStatusMessage) => void) => {
      const listener = (_event: IpcRendererEvent, message: UpdateStatusMessage) => callback(message);
      ipcRenderer.on('update-message', listener);
      return () => {
        ipcRenderer.removeListener('update-message', listener);
      };
    },

    // --- API 端口设置 ---
    onApiPortSet: (callback: (port: number) => void) =>
      ipcRenderer.on('set-api-port', (_event: IpcRendererEvent, port: number) => callback(port)),

    // --- 窗口操作 ---
    windowAction: (action: 'minimize' | 'maximize' | 'close') => {
      ipcRenderer.send('window-action', action);
    },

    onWindowMaximizedState: (callback: (isMaximized: boolean) => void) => {
      const listener = (_event: IpcRendererEvent, isMaximized: boolean) => callback(isMaximized);
      ipcRenderer.on('window-maximized-state', listener);
      return () => {
        ipcRenderer.removeListener('window-maximized-state', listener);
      };
    },

    onWindowFocusState: (callback: (focused: boolean) => void) =>
      subscribeWindowFocusState(ipcRenderer, callback),

    // --- 文件对话框（通用能力，当前由主进程实现）---
    openFileDialog: (options: unknown) => ipcRenderer.invoke('open-file-dialog', options),
    openDirectoryDialog: (options: unknown) => ipcRenderer.invoke('open-directory-dialog', options),

    // --- 图片和音频处理 ---
    myAppSelectImageDialog: (options?: { title?: string; imageFilterName?: string }) =>
      ipcRenderer.invoke('select-image', options),

    embedImageBytes: (request: { documentNodeId: string; bytes: ArrayBuffer; ext: string; fileName?: string }) =>
      ipcRenderer.invoke('media:embed-image-bytes', request),

    pickAndEmbedImage: (request: { documentNodeId: string; title?: string; imageFilterName?: string }) =>
      ipcRenderer.invoke('media:pick-and-embed-image', request),

    loadImageAsDataURL: (filePath: string) =>
      ipcRenderer.invoke('load-image-as-data-url', filePath),

    statImageFile: (filePath: string) =>
      ipcRenderer.invoke('stat-image-file', filePath),

    saveAudioFile: (audioDataBuffer: ArrayBuffer, mimeType: string) => {
      console.log(`[Preload] Requesting to save audio file. MimeType: ${mimeType}`);
      return ipcRenderer.invoke('save-audio-file', audioDataBuffer, mimeType);
    },

    loadAudioFileAsDataURL: (filePath: string) => {
      console.log(`[Preload] Requesting to load audio file as Data URL: ${filePath}`);
      return ipcRenderer.invoke('load-audio-file-as-data-url', filePath);
    },

    getFileSize: (filePath: string) => ipcRenderer.invoke('get-file-size', filePath),
    showItemInFolder: (filePath: string) => ipcRenderer.invoke('show-item-in-folder', filePath),
    getElectronProcessMemory: () => ipcRenderer.invoke('system:get-process-memory-metrics'),

    /**
     * 使用系统默认浏览器打开外部链接
     *
     * 中文说明：
     * - 统一从主进程调用 shell.openExternal，避免渲染进程 window.open 导致在应用内加载远程网页；
     * - 主进程会做协议校验（仅允许 http/https）。
     */
    openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', url),

    // --- 文件导出 ---
    exportFile: (
      defaultFileName: string,
      content: unknown,
      options: string | { fileType: string; title?: string; buttonLabel?: string; filterName?: string },
    ) =>
      ipcRenderer.invoke('export-file', defaultFileName, content, options),
    exportPDF: (
      defaultFileName: string,
      payload: string | { htmlContent: string; title?: string; buttonLabel?: string; filterName?: string },
    ) =>
      ipcRenderer.invoke('export-pdf', defaultFileName, payload),
    requestExportArtifactTarget: (request: ExportArtifactTargetRequest) =>
      ipcRenderer.invoke('export-artifact:request-target', request),
    /**
     * 批量导出：写入到用户选择的目录（主进程负责重名处理）
     *
     * 中文说明：
     * - 渲染进程先调用 openDirectoryDialog 获取 directoryPath；
     * - 然后调用此方法一次性写入多个文件，避免每个文件都弹 save dialog。
     */
    exportFilesToDirectory: (payload: { directoryPath: string; files: Array<{ fileName: string; content: string }> }) =>
      ipcRenderer.invoke('export-files-to-directory', payload),

    // --- 任务状态 ---
    onTaskStatusUpdate: (callback: (statusUpdate: any) => void) => {
      const listener = (_event: any, statusUpdate: any) => callback(statusUpdate);
      ipcRenderer.on('task-status-update', listener);
      return () => {
        ipcRenderer.removeListener('task-status-update', listener);
      };
    },

    // --- 转录进度 ---
    onTranscriptionProgress: (
      callback: (progress: { stage: string; percent: number; message: string; timestamp: number }) => void
    ) => {
      const listener = (_event: any, progress: any) => callback(progress);
      ipcRenderer.on('transcription:progress', listener);
      return () => {
        ipcRenderer.removeListener('transcription:progress', listener);
      };
    },
  };
}
