/**
 * @file src/electron-main/preload/modules/knowledge-base-preload.ts
 *
 * @description
 * 知识库相关的 preload API（含 Project ↔ KnowledgeBase 关联）。
 *
 * 说明：本文件只做拆分归档，不修改任何 IPC channel 与参数结构。
 */

import type { IpcRenderer } from 'electron';

export function buildKnowledgeBasePreloadApi(ipcRenderer: IpcRenderer) {
  return {
    // --- 知识库操作 ---
    getAllKbs: () => ipcRenderer.invoke('get-all-kbs'),
    createKb: (name: string, description?: string) => ipcRenderer.invoke('create-kb', { name, description }),
    deleteKb: (kbId: string) => ipcRenderer.invoke('delete-kb', kbId),
    getDocumentsInKb: (kbId: string) => ipcRenderer.invoke('get-documents-in-kb', kbId),
    /**
     * 更新知识库设置（与 HTTP PATCH /knowledge-base/:kbId/settings 语义对齐）
     *
     * 说明：
     * - settings 允许包含 name/description/tags 以及 embedding_model_id 等字段；
     * - 主进程 handler 会做明确字段映射到应用层 payload（camelCase）。
     */
    updateKbSettings: (kbId: string, settings: unknown) =>
      ipcRenderer.invoke('update-kb-settings', { kbId, settings }),
    addDocumentToKb: (kbId: string) => ipcRenderer.invoke('add-document-to-kb', kbId),
    deleteDocumentInKb: (kbId: string, docId: string) => ipcRenderer.invoke('delete-document-in-kb', { kbId, docId }),
    getTasksStatus: (docIds: string[]) => ipcRenderer.invoke('get-tasks-status', docIds),
    searchKb: (request: any) => ipcRenderer.invoke('search-kb', request),
    readSotDocument: (docId: string, startPage?: number, endPage?: number) =>
      ipcRenderer.invoke('read-sot-document', { docId, startPage, endPage }),
    getDefaultKb: () => ipcRenderer.invoke('get-default-kb'),

    // --- Soft Knowledge Graph（M4：进度）---
    getKbGraphProgress: (kbId: string) => ipcRenderer.invoke('get-kb-graph-progress', kbId),
    onKbGraphProgressUpdated: (callback: (payload: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on('kb-graph-progress-updated', listener);
      return () => {
        ipcRenderer.removeListener('kb-graph-progress-updated', listener);
      };
    },

    // --- Project ↔ KnowledgeBase 关联 IPC ---
    'project-kb-links:list-project-ids': (kbId: string) => ipcRenderer.invoke('project-kb-links:list-project-ids', kbId),
    'project-kb-links:clear-kb': (kbId: string) => ipcRenderer.invoke('project-kb-links:clear-kb', kbId),
    'project-kb-links:link': (projectId: string, kbId: string, role: 'read_only' | 'read_write' = 'read_write') =>
      ipcRenderer.invoke('project-kb-links:link', projectId, kbId, role),
    'project-kb-links:clear-project': (projectId: string) => ipcRenderer.invoke('project-kb-links:clear-project', projectId),
    'project-kb-links:link-multiple': (
      projectId: string,
      kbIds: string[],
      role: 'read_only' | 'read_write' = 'read_write'
    ) => ipcRenderer.invoke('project-kb-links:link-multiple', projectId, kbIds, role),
    'project-kb-links:list-kb-ids': (projectId: string) => ipcRenderer.invoke('project-kb-links:list-kb-ids', projectId),
    'project-kb-links:list-kb-details': (projectId: string) => ipcRenderer.invoke('project-kb-links:list-kb-details', projectId),
  };
}


