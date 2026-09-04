/**
 * @file src/electron-main/preload/modules/workspace-preload.ts
 *
 * @description Workspace / 文档相关的 preload API。
 *
 * 说明：这里暴露的是“渲染进程调用主进程 IPC”的薄包装，不承载业务逻辑。
 */

import type { IpcRenderer, IpcRendererEvent } from 'electron';
import {
  WORKSPACE_MUTATION_CHANNEL,
  type WorkspaceMutationEvent,
} from '@app/schemas';
import type {
  CreateProjectArgs,
  UpdateProjectArgs,
  DeleteProjectArgs,
  ListNodesArgs,
  ListVfsNodesArgs,
  ReadVfsNodeArgs,
  SearchVfsNodesArgs,
  CreateFolderArgs,
  CreateDocumentArgs,
  DeleteNodeArgs,
  RenameNodeArgs,
  DuplicateNodeArgs,
  MoveNodeArgs,
  InspectNodeTransferArgs,
  TransferNodeArgs,
  ReadDocumentArgs,
  SaveDocumentArgs,
  SetPendingRevisionArgs,
  SetPendingRevisionsBatchArgs,
  ClearPendingRevisionArgs,
  ClearAllPendingRevisionsArgs,
  ApplyAllPendingRevisionsArgs,
  ApplyPendingRevisionArgs,
  NotifyDocumentOpenedArgs,
  GetRecentDocumentsArgs,
  AudioBlockGetAllContentArgs,
  AudioBlockUpdateNoteArgs,
  AudioBlockUpdateTranscriptArgs,
  AudioBlockUpdateSummaryArgs,
} from '../types';

export function buildWorkspacePreloadApi(ipcRenderer: IpcRenderer) {
  return {
    // --- Workspace ---
    'workspace:create-project': (args: CreateProjectArgs) => ipcRenderer.invoke('workspace:create-project', args),
    'workspace:ensure-default-project': () => ipcRenderer.invoke('workspace:ensure-default-project'),
    'workspace:list-projects': () => ipcRenderer.invoke('workspace:list-projects'),
    'workspace:update-project': (args: UpdateProjectArgs) => ipcRenderer.invoke('workspace:update-project', args),
    'workspace:delete-project': (args: DeleteProjectArgs) => ipcRenderer.invoke('workspace:delete-project', args),
    'workspace:list-nodes': (args: ListNodesArgs) => ipcRenderer.invoke('workspace:list-nodes', args),
    'workspace:list-vfs-nodes': (args: ListVfsNodesArgs) => ipcRenderer.invoke('workspace:list-vfs-nodes', args),
    'workspace:read-vfs-node': (args: ReadVfsNodeArgs) => ipcRenderer.invoke('workspace:read-vfs-node', args),
    'workspace:search-vfs-nodes': (args: SearchVfsNodesArgs) => ipcRenderer.invoke('workspace:search-vfs-nodes', args),
    'workspace:create-folder': (args: CreateFolderArgs) => ipcRenderer.invoke('workspace:create-folder', args),
    'workspace:create-document': (args: CreateDocumentArgs) => ipcRenderer.invoke('workspace:create-document', args),
    'workspace:delete-node': (args: DeleteNodeArgs) => ipcRenderer.invoke('workspace:delete-node', args),
    'workspace:rename-node': (args: RenameNodeArgs) => ipcRenderer.invoke('workspace:rename-node', args),
    'workspace:duplicate-node': (args: DuplicateNodeArgs) => ipcRenderer.invoke('workspace:duplicate-node', args),
    'workspace:move-node': (args: MoveNodeArgs) => ipcRenderer.invoke('workspace:move-node', args),
    'workspace:inspect-node-transfer': (args: InspectNodeTransferArgs) =>
      ipcRenderer.invoke('workspace:inspect-node-transfer', args),
    'workspace:transfer-node': (args: TransferNodeArgs) => ipcRenderer.invoke('workspace:transfer-node', args),
    'workspace:read-document': (args: ReadDocumentArgs) => ipcRenderer.invoke('workspace:read-document', args),
    'workspace:save-document': (args: SaveDocumentArgs) => ipcRenderer.invoke('workspace:save-document', args),
    'workspace:set-pending-revision': (args: SetPendingRevisionArgs) =>
      ipcRenderer.invoke('workspace:set-pending-revision', args),
    'workspace:set-pending-revisions-batch': (args: SetPendingRevisionsBatchArgs) =>
      ipcRenderer.invoke('workspace:set-pending-revisions-batch', args),
    'workspace:clear-pending-revision': (args: ClearPendingRevisionArgs) =>
      ipcRenderer.invoke('workspace:clear-pending-revision', args),
    'workspace:clear-all-pending-revisions': (args: ClearAllPendingRevisionsArgs) =>
      ipcRenderer.invoke('workspace:clear-all-pending-revisions', args),
    'workspace:apply-all-pending-revisions': (args: ApplyAllPendingRevisionsArgs) =>
      ipcRenderer.invoke('workspace:apply-all-pending-revisions', args),
    'workspace:apply-pending-revision': (args: ApplyPendingRevisionArgs) =>
      ipcRenderer.invoke('workspace:apply-pending-revision', args),
    'workspace:run-migration': () => ipcRenderer.invoke('workspace:run-migration'),
    'workspace:notify-document-opened': (args: NotifyDocumentOpenedArgs) =>
      ipcRenderer.invoke('workspace:notify-document-opened', args),
    'workspace:get-recent-documents': (args: GetRecentDocumentsArgs) =>
      ipcRenderer.invoke('workspace:get-recent-documents', args),
    'workspace:get-project-char-stats': (args: { projectId: string }) =>
      ipcRenderer.invoke('workspace:get-project-char-stats', args),
    onWorkspaceMutation: (callback: (event: WorkspaceMutationEvent) => void) => {
      const listener = (_event: IpcRendererEvent, payload: WorkspaceMutationEvent) => callback(payload);
      ipcRenderer.on(WORKSPACE_MUTATION_CHANNEL, listener);
      return () => ipcRenderer.removeListener(WORKSPACE_MUTATION_CHANNEL, listener);
    },

    // --- Agents（审阅角色等） ---
    'workspace:list-agents': (args: { type?: string }) => ipcRenderer.invoke('workspace:list-agents', args),
    'workspace:get-agent': (args: { id: string }) => ipcRenderer.invoke('workspace:get-agent', args),
    'workspace:create-agent': (args: { type: string; name: string; systemPrompt: string; knowledge?: string }) =>
      ipcRenderer.invoke('workspace:create-agent', args),
    'workspace:update-agent': (args: { id: string; name?: string; systemPrompt?: string; knowledge?: string }) =>
      ipcRenderer.invoke('workspace:update-agent', args),
    'workspace:delete-agent': (args: { id: string }) => ipcRenderer.invoke('workspace:delete-agent', args),

    // --- AudioBlock ---
    'audio-block:get-all-content': (args: AudioBlockGetAllContentArgs) => ipcRenderer.invoke('audio-block:get-all-content', args),
    'audio-block:update-note': (args: AudioBlockUpdateNoteArgs) => ipcRenderer.invoke('audio-block:update-note', args),
    'audio-block:update-transcript': (args: AudioBlockUpdateTranscriptArgs) =>
      ipcRenderer.invoke('audio-block:update-transcript', args),
    'audio-block:update-summary': (args: AudioBlockUpdateSummaryArgs) => ipcRenderer.invoke('audio-block:update-summary', args),
  };
}
