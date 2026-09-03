/**
 * @file src/electron-main/preload/index.ts
 *
 * @brief Electron 预加载脚本（按 Feature 拆分后的聚合入口）
 */

import { contextBridge, ipcRenderer } from 'electron';
import { VALID_CHANNELS } from './valid-channels';
import { buildCommonIpcApi } from './modules/common-ipc';
import { buildSystemPreloadApi } from './modules/system-preload';
import { buildKnowledgeBasePreloadApi } from './modules/knowledge-base-preload';
import { buildModelsPreloadApi } from './modules/models-preload';
import { buildCommandPermissionSettingsPreloadApi } from './modules/command-permission-settings-preload';
import { buildCommandRuntimePreloadApi } from './modules/command-runtime-preload';
import { buildWorkspacePreloadApi } from './modules/workspace-preload';
import { buildTodoPreloadApi } from './modules/todo-preload';
import { buildBlockHistoryPreloadApi } from './modules/block-history-preload';
import { buildPluginsPreloadApi } from './modules/plugins-preload';
import { buildMediaUrlPreloadApi } from './modules/media-url';
import { buildConversationFileLinkPreloadApi } from './modules/conversation-file-link-preload';

// 向渲染进程暴露安全的 API（保持 window.electronAPI 的字段与行为不变）
contextBridge.exposeInMainWorld('electronAPI', {
  ...buildSystemPreloadApi(ipcRenderer),
  ...buildKnowledgeBasePreloadApi(ipcRenderer),
  ...buildModelsPreloadApi(ipcRenderer),
  ...buildCommandPermissionSettingsPreloadApi(ipcRenderer),
  ...buildCommandRuntimePreloadApi(ipcRenderer),

  // 通用透传（带白名单 gate）
  ...buildCommonIpcApi(ipcRenderer, VALID_CHANNELS),

  // workspace / documents / tools / todo / block-history 等“强类型 IPC”
  ...buildWorkspacePreloadApi(ipcRenderer),
  ...buildTodoPreloadApi(ipcRenderer),
  ...buildBlockHistoryPreloadApi(ipcRenderer),
  ...buildPluginsPreloadApi(ipcRenderer),
  ...buildConversationFileLinkPreloadApi(ipcRenderer),
});

// 媒体资源 URL 只能由 preload 统一构造，避免渲染层手写 media:// 字符串重新暴露路径边界。
contextBridge.exposeInMainWorld('linnyaMedia', buildMediaUrlPreloadApi(ipcRenderer));

console.log('[Preload] Electron preload script loaded');
