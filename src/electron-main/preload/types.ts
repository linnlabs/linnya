/**
 * @file src/electron-main/preload/types.ts
 *
 * @description
 * 预加载层（preload）对渲染进程暴露 API 时使用的参数类型集合。
 *
 * 注意：
 * - 这里的类型来自历史 `preload.ts`，仅做文件拆分与归档；
 * - 本阶段不修改业务逻辑与 IPC channel 协议。
 */

import type { WorkspaceNodeTransferRequest } from '@app/schemas';

// +++ 从 workspaceGateway.ts 复制过来的类型定义 +++
export type CreateProjectArgs = { name: string; description?: string };
export type UpdateProjectArgs = { projectId: string; name?: string; description?: string };
export type DeleteProjectArgs = { projectId: string };
export type ListNodesArgs = { projectId: string; parentId?: string | null };
export type ListVfsNodesArgs = {
  projectId: string;
  parentId?: string | null;
  conversationId?: string | null;
  instanceId?: string | null;
  includeSystemNodes?: boolean;
};
export type ReadVfsNodeArgs = {
  projectId: string;
  path?: string;
  inode?: string;
  conversationId?: string | null;
  instanceId?: string | null;
  maxChars?: number;
};
export type SearchVfsNodesArgs = {
  projectId: string;
  pattern: string;
  path?: string;
  inode?: string;
  conversationId?: string | null;
  instanceId?: string | null;
  maxResults?: number;
};
export type CreateFolderArgs = { projectId: string; name: string; parentId?: string | null };
export type CreateDocumentArgs = {
  projectId: string;
  name: string;
  parentId?: string | null;
  content?: unknown;
  /** 平台只透传 document type；具体字符串由已注册插件贡献。 */
  type?: string;
};
export type DeleteNodeArgs = { nodeId: string };
export type RenameNodeArgs = { nodeId: string; newName: string };
export type DuplicateNodeArgs = { nodeId: string };
export type MoveNodeArgs = { nodeId: string; newParentId?: string | null };
export type InspectNodeTransferArgs = WorkspaceNodeTransferRequest;
export type TransferNodeArgs = WorkspaceNodeTransferRequest;
export type ReadDocumentArgs = { documentId: string };
export type SaveDocumentArgs = { documentId: string; content: unknown };
export type SetPendingRevisionArgs = {
  documentId: string;
  blockId: string;
  newMarkdown: string;
  source?: 'ai' | 'user' | 'tool';
  meta?: Record<string, unknown>;
};
export type SetPendingRevisionsBatchArgs = {
  documentId: string;
  revisions: Array<{
    blockId: string;
    newMarkdown: string;
    source?: 'ai' | 'user' | 'tool';
    meta?: Record<string, unknown>;
  }>;
};
export type ClearPendingRevisionArgs = { documentId: string; blockId: string };
export type ClearAllPendingRevisionsArgs = { documentId: string };
export type ApplyAllPendingRevisionsArgs = { documentId: string; mode: 'accept' | 'reject' };
export type ApplyPendingRevisionArgs = { documentId: string; blockId: string; mode: 'accept' | 'reject' };
export type NotifyDocumentOpenedArgs = { documentId: string };
export type GetRecentDocumentsArgs = {
  limit?: number;
  projectId?: string | null;
};

// +++ AudioBlock Gateway 类型定义 +++
export type AudioBlockGetAllContentArgs = { audioBlockId: string };
export type AudioBlockUpdateNoteArgs = { audioBlockId: string; content: string };
export type AudioBlockUpdateTranscriptArgs = { audioBlockId: string; content: unknown };
export type AudioBlockUpdateSummaryArgs = { audioBlockId: string; content: string };

// +++ BlockHistory Gateway 类型定义（与 blockHistoryGateway.ts 对齐） +++
export type BlockHistoryListVersionsArgs = {
  documentNodeId: string;
  targetBlockId: string;
};

export type BlockHistoryGetVersionArgs = {
  versionId: string;
};

export type BlockHistoryCreateVersionArgs = {
  documentNodeId: string;
  targetBlockId: string;
  blockType: string;
  contentJson: string;
  originType: 'manual' | 'ai' | 'restore';
  originMetadata?: {
    modelId?: string;
    prompt?: string;
    diffStats?: { insertCount: number; deleteCount: number };
    restoredFromVersionId?: string;
  };
};

export type BlockHistoryRestoreVersionArgs = {
  documentNodeId: string;
  targetBlockId: string;
  sourceVersionId: string;
};

export type BlockHistoryBlockScopedArgs = {
  documentNodeId: string;
  targetBlockId: string;
};

export type BlockHistoryDeleteVersionArgs = {
  versionId: string;
};

// +++ Todo Gateway 类型定义 +++
export type NewTodoPayload = {
  projectId: string;
  title: string;
  description?: string;
  status: 'scheduled' | 'todo' | 'completed';
  priority?: 'high' | 'medium' | 'low';
  customTags?: string[];
  dueDate?: string;
  dueTime?: string;
};

export type UpdateTodoPayload = Partial<Omit<NewTodoPayload, 'projectId'>>;
export type AddTodoArgs = NewTodoPayload;
export type UpdateTodoArgs = { todoId: string; updates: UpdateTodoPayload };
