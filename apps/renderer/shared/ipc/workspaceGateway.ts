/**
 * @file apps/renderer/shared/ipc/workspaceGateway.ts
 *
 * @brief 工作区数据库 IPC 网关 (渲染进程侧)
 *
 * @description
 * 此模块是渲染进程与主进程新版工作区数据库通信的唯一入口。
 * 它封装了所有对 window.electronAPI 中 'workspace:*' 前缀的调用,提供类型安全的接口。
 */

import type {
  OperationResult,
  WorkspaceNodeTransferRequest,
  WorkspaceNodeTransferResult,
} from '@app/schemas';

// TODO: 定义与后端匹配的完整类型
// import type { Project, WorkspaceNode, DocumentContent, Annotation } from '../types/workspace';

/**
 * Pending Revision 记录（前端友好格式）
 * 对应后端 PendingRevision 但字段名使用 camelCase
 */
export interface PendingRevisionDTO {
  id: string;
  blockId: string;
  newMarkdown: string;
  source: 'ai' | 'user' | 'tool';
  /** 显式操作类型（v20 新增），优先于 metaJson 中的 operation */
  operation: 'insert' | 'update' | 'delete' | null;
  metaJson: string | null;
  createdAt: number;
  updatedAt: number | null;
}

/**
 * 最近访问文档摘要（工作区数据库原始字段）
 */
export interface RecentDocumentDTO {
  id: string;
  name: string;
  project_id: string | null;
  parent_id: string | null;
  project_name: string | null;
  last_opened_at: number | null;
  updated_at: number;
  access_count: number;
  type: string;
}

export type WorkspaceProjectSystemRole = 'default';

export interface WorkspaceProjectDTO {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  system_role: WorkspaceProjectSystemRole | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  can_delete: boolean;
}

export interface WorkspaceNodeDTO {
  id: string;
  inode?: string;
  path?: string;
  project_id: string | null;
  parent_id: string | null;
  type: string;
  name: string;
  display_name?: string;
  icon: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  last_opened_at: number | null;
  access_count: number;
  tags: string | null;
  is_virtual?: boolean;
  source?: string;
  payload?: Record<string, unknown>;
}

export type WorkspaceVfsReadDTO =
  | {
      ok: true;
      node: WorkspaceNodeDTO;
      contentType: string;
      text: string;
      truncated: boolean;
      metadata?: Record<string, unknown>;
    }
  | {
      ok: false;
      error_code: string;
      message: string;
      hint?: string;
    };

export interface WorkspaceVfsSearchMatchDTO {
  node: WorkspaceNodeDTO;
  line: number;
  column: number;
  preview: string;
}

export type WorkspaceVfsSearchDTO =
  | {
      ok: true;
      matches: WorkspaceVfsSearchMatchDTO[];
      truncated: boolean;
    }
  | {
      ok: false;
      error_code: string;
      message: string;
      hint?: string;
    };

export interface ProseMirrorJsonNodeDTO {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorJsonNodeDTO[];
  text?: string;
  marks?: Array<{
    type: string;
    attrs?: Record<string, unknown>;
  }>;
}

export interface MarkdownDocJsonDTO extends ProseMirrorJsonNodeDTO {
  type: 'doc';
  content: ProseMirrorJsonNodeDTO[];
}

export type ApplyAllPendingMode = 'accept' | 'reject';

export interface ApplyAllPendingResultDTO {
  status: 'ok' | 'failed';
  documentId: string;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  docJson: MarkdownDocJsonDTO;
  errors?: Array<{ blockId: string; reason: string }>;
}

export interface ApplySinglePendingResultDTO {
  status: 'ok' | 'failed';
  documentId: string;
  blockId: string;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  errors?: Array<{ blockId: string; reason: string }>;
}

export type { OperationResult } from '@app/schemas';

/**
 * 新的工作区 IPC 网关接口
 * 命名与 src/electron-main/ipc/handlers/workspace-ipc.ts 中的 handle 名称对应
 */
export interface IWorkspaceGateway {
  // 项目管理
  'create-project'(args: { name: string; description?: string }): Promise<OperationResult<{ projectId: string }>>;
  'ensure-default-project'(): Promise<OperationResult<{ projectId: string }>>;
  'list-projects'(): Promise<OperationResult<{ projects: WorkspaceProjectDTO[] }>>;
  'update-project'(args: { projectId: string; name?: string; description?: string }): Promise<OperationResult<void>>;
  'delete-project'(args: { projectId: string }): Promise<OperationResult<void>>;

  // 节点管理 (文件树)
  'list-nodes'(args: { projectId: string; parentId?: string | null }): Promise<OperationResult<WorkspaceNodeDTO[]>>;
  'list-vfs-nodes'(args: {
    projectId: string;
    parentId?: string | null;
    conversationId?: string | null;
    instanceId?: string | null;
    includeSystemNodes?: boolean;
  }): Promise<OperationResult<WorkspaceNodeDTO[]>>;
  'read-vfs-node'(args: {
    projectId: string;
    path?: string;
    inode?: string;
    conversationId?: string | null;
    instanceId?: string | null;
    maxChars?: number;
  }): Promise<OperationResult<WorkspaceVfsReadDTO>>;
  'search-vfs-nodes'(args: {
    projectId: string;
    pattern: string;
    path?: string;
    inode?: string;
    conversationId?: string | null;
    instanceId?: string | null;
    maxResults?: number;
  }): Promise<OperationResult<WorkspaceVfsSearchDTO>>;
  'create-folder'(args: { projectId: string; name: string; parentId?: string | null }): Promise<OperationResult<{ folderId: string }>>;
  'create-document'(args: { projectId: string; name: string; parentId?: string | null; content?: unknown; type?: string }): Promise<OperationResult<{ documentId: string }>>;
  'delete-node'(args: { nodeId: string }): Promise<OperationResult<{ deletedNodeIds: string[] }>>;
  'rename-node'(args: { nodeId: string; newName: string }): Promise<OperationResult<void>>;
  'duplicate-node'(args: { nodeId: string }): Promise<OperationResult<{ nodeId: string }>>;
  'move-node'(args: { nodeId: string; newParentId?: string | null }): Promise<OperationResult<void>>;
  'inspect-node-transfer'(args: WorkspaceNodeTransferRequest): Promise<OperationResult<WorkspaceNodeTransferResult>>;
  'transfer-node'(args: WorkspaceNodeTransferRequest): Promise<OperationResult<WorkspaceNodeTransferResult>>;
  'notify-document-opened'(args: { documentId: string }): Promise<OperationResult<void>>;
  'get-recent-documents'(args?: {
    limit?: number;
    projectId?: string | null;
  }): Promise<OperationResult<RecentDocumentDTO[]>>;
  'get-project-char-stats'(args: { projectId: string }): Promise<OperationResult<{ projectId: string; charCount: number }>>;

  // 文档操作
  'read-document'(args: { documentId: string }): Promise<OperationResult<{ content: any; pendingRevisions: PendingRevisionDTO[]; versionNumber?: number }>>;
  'save-document'(args: { documentId: string; content: any }): Promise<OperationResult<void>>;
  
  // Pending Revisions（AI 修订意图）操作
  'set-pending-revision'(args: {
    documentId: string;
    blockId: string;
    newMarkdown: string;
    source?: 'ai' | 'user' | 'tool';
    meta?: Record<string, unknown>;
  }): Promise<OperationResult<PendingRevisionDTO>>;
  'set-pending-revisions-batch'(args: {
    documentId: string;
    revisions: Array<{
      blockId: string;
      newMarkdown: string;
      source?: 'ai' | 'user' | 'tool';
      meta?: Record<string, unknown>;
    }>;
  }): Promise<OperationResult<{ writtenCount: number; totalRequested: number; errors: string[] }>>;
  'clear-pending-revision'(args: { documentId: string; blockId: string }): Promise<OperationResult<{ deletedCount: number }>>;
  'clear-all-pending-revisions'(args: { documentId: string }): Promise<OperationResult<{ deletedCount: number }>>;
  'apply-all-pending-revisions'(args: {
    documentId: string;
    mode: ApplyAllPendingMode;
  }): Promise<OperationResult<ApplyAllPendingResultDTO>>;
  'apply-pending-revision'(args: {
    documentId: string;
    blockId: string;
    mode: ApplyAllPendingMode;
  }): Promise<OperationResult<ApplySinglePendingResultDTO>>;

  // 迁移
  'run-migration'(): Promise<OperationResult<void>>;
}


class WorkspaceGatewayImpl implements IWorkspaceGateway {
  private electronAPI: any;

  constructor() {
    if (!(window as any).electronAPI) {
      throw new Error('[WorkspaceGateway] window.electronAPI is not available');
    }
    this.electronAPI = (window as any).electronAPI;
  }

  private async invoke<T>(channel: string, ...args: any[]): Promise<OperationResult<T>> {
    const ipcChannel = `workspace:${channel}`;
    try {
      if (typeof this.electronAPI[ipcChannel] !== 'function') {
        throw new Error(`IPC channel "${ipcChannel}" is not a function on electronAPI.`);
      }
      const result = await this.electronAPI[ipcChannel](...args);
      return result as OperationResult<T>;
    } catch (error) {
      console.error(`[WorkspaceGateway] IPC call to "${ipcChannel}" failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : `Unknown IPC error on channel ${ipcChannel}`,
      };
    }
  }

  // 项目管理
  'create-project'(args: { name: string; description?: string }): Promise<OperationResult<{ projectId: string }>> {
    return this.invoke('create-project', args);
  }
  'ensure-default-project'(): Promise<OperationResult<{ projectId: string }>> {
    return this.invoke('ensure-default-project');
  }
  'list-projects'(): Promise<OperationResult<{ projects: WorkspaceProjectDTO[] }>> {
    return this.invoke('list-projects');
  }
  'update-project'(args: { projectId: string; name?: string; description?: string }): Promise<OperationResult<void>> {
    return this.invoke('update-project', args);
  }
  'delete-project'(args: { projectId: string }): Promise<OperationResult<void>> {
    return this.invoke('delete-project', args);
  }

  // 节点管理
  'list-nodes'(args: { projectId: string; parentId?: string | null }): Promise<OperationResult<WorkspaceNodeDTO[]>> {
    return this.invoke('list-nodes', args);
  }
  'list-vfs-nodes'(args: {
    projectId: string;
    parentId?: string | null;
    conversationId?: string | null;
    instanceId?: string | null;
    includeSystemNodes?: boolean;
  }): Promise<OperationResult<WorkspaceNodeDTO[]>> {
    return this.invoke('list-vfs-nodes', args);
  }
  'read-vfs-node'(args: {
    projectId: string;
    path?: string;
    inode?: string;
    conversationId?: string | null;
    instanceId?: string | null;
    maxChars?: number;
  }): Promise<OperationResult<WorkspaceVfsReadDTO>> {
    return this.invoke('read-vfs-node', args);
  }
  'search-vfs-nodes'(args: {
    projectId: string;
    pattern: string;
    path?: string;
    inode?: string;
    conversationId?: string | null;
    instanceId?: string | null;
    maxResults?: number;
  }): Promise<OperationResult<WorkspaceVfsSearchDTO>> {
    return this.invoke('search-vfs-nodes', args);
  }
  'create-folder'(args: { projectId: string; name: string; parentId?: string | null }): Promise<OperationResult<{ folderId: string }>> {
    return this.invoke('create-folder', args);
  }
  'create-document'(args: { projectId: string; name: string; parentId?: string | null; content?: unknown; type?: string }): Promise<OperationResult<{ documentId: string }>> {
    return this.invoke('create-document', args);
  }
  'delete-node'(args: { nodeId: string }): Promise<OperationResult<{ deletedNodeIds: string[] }>> {
    return this.invoke('delete-node', args);
  }
  'rename-node'(args: { nodeId: string; newName: string }): Promise<OperationResult<void>> {
    return this.invoke('rename-node', args);
  }
  'duplicate-node'(args: { nodeId: string }): Promise<OperationResult<{ nodeId: string }>> {
    return this.invoke('duplicate-node', args);
  }
  'move-node'(args: { nodeId: string; newParentId?: string | null }): Promise<OperationResult<void>> {
    return this.invoke('move-node', args);
  }
  'inspect-node-transfer'(args: WorkspaceNodeTransferRequest): Promise<OperationResult<WorkspaceNodeTransferResult>> {
    return this.invoke('inspect-node-transfer', args);
  }
  'transfer-node'(args: WorkspaceNodeTransferRequest): Promise<OperationResult<WorkspaceNodeTransferResult>> {
    return this.invoke('transfer-node', args);
  }
  'notify-document-opened'(args: { documentId: string }): Promise<OperationResult<void>> {
    return this.invoke('notify-document-opened', args);
  }
  'get-recent-documents'(args: {
    limit?: number;
    projectId?: string | null;
  } = {}): Promise<OperationResult<RecentDocumentDTO[]>> {
    return this.invoke('get-recent-documents', args);
  }
  'get-project-char-stats'(args: { projectId: string }): Promise<OperationResult<{ projectId: string; charCount: number }>> {
    return this.invoke('get-project-char-stats', args);
  }

  // 文档操作
  'read-document'(args: { documentId: string }): Promise<OperationResult<{ content: any; pendingRevisions: PendingRevisionDTO[]; versionNumber?: number }>> {
    return this.invoke('read-document', args);
  }
  'save-document'(args: { documentId: string; content: any }): Promise<OperationResult<void>> {
    return this.invoke('save-document', args);
  }

  // Pending Revisions（AI 修订意图）操作
  'set-pending-revision'(args: {
    documentId: string;
    blockId: string;
    newMarkdown: string;
    source?: 'ai' | 'user' | 'tool';
    meta?: Record<string, unknown>;
  }): Promise<OperationResult<PendingRevisionDTO>> {
    return this.invoke('set-pending-revision', args);
  }
  'set-pending-revisions-batch'(args: {
    documentId: string;
    revisions: Array<{
      blockId: string;
      newMarkdown: string;
      source?: 'ai' | 'user' | 'tool';
      meta?: Record<string, unknown>;
    }>;
  }): Promise<OperationResult<{ writtenCount: number; totalRequested: number; errors: string[] }>> {
    return this.invoke('set-pending-revisions-batch', args);
  }
  'clear-pending-revision'(args: { documentId: string; blockId: string }): Promise<OperationResult<{ deletedCount: number }>> {
    return this.invoke('clear-pending-revision', args);
  }
  'clear-all-pending-revisions'(args: { documentId: string }): Promise<OperationResult<{ deletedCount: number }>> {
    return this.invoke('clear-all-pending-revisions', args);
  }
  'apply-all-pending-revisions'(args: {
    documentId: string;
    mode: ApplyAllPendingMode;
  }): Promise<OperationResult<ApplyAllPendingResultDTO>> {
    return this.invoke('apply-all-pending-revisions', args);
  }
  'apply-pending-revision'(args: {
    documentId: string;
    blockId: string;
    mode: ApplyAllPendingMode;
  }): Promise<OperationResult<ApplySinglePendingResultDTO>> {
    return this.invoke('apply-pending-revision', args);
  }

  // 迁移
  'run-migration'(): Promise<OperationResult<void>> {
    return this.invoke('run-migration');
  }
}

/**
 * Workspace 网关单例实例
 */
export const workspaceGateway: IWorkspaceGateway = new WorkspaceGatewayImpl();
