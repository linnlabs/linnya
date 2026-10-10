/**
 * @file fileToolContext.ts
 * @description 文件工具层上下文解析。
 */

import type { ToolContext } from '../../types';
import type { WorkspaceVfsDatabase } from '../../../features/workspace/vfs/orchestration/listWorkspaceVfsNodes';
import {
  resolveToolConversationId,
  resolveToolConversationInstanceId,
} from 'src/app-hosts/linnya/adapters/tools/conversation-scope';

export interface WorkspaceFileToolRuntime {
  readonly db: WorkspaceVfsDatabase;
  readonly projectId: string;
  readonly conversationId?: string;
  readonly instanceId: string;
}

function readRequiredProjectId(context: ToolContext): string {
  const projectId = typeof context.workspaceProjectId === 'string'
    ? context.workspaceProjectId.trim()
    : '';
  if (!projectId) {
    throw new Error('当前对话没有绑定 Workspace 项目，无法使用文件工具。请在某个 Workspace 项目中发起对话后再调用。');
  }
  return projectId;
}

function isWorkspaceVfsDatabase(value: unknown): value is WorkspaceVfsDatabase {
  return !!value &&
    typeof value === 'object' &&
    'prepare' in value &&
    typeof value.prepare === 'function';
}

export function resolveWorkspaceFileToolRuntime(context: ToolContext): WorkspaceFileToolRuntime {
  const databaseService = context.databaseService;
  if (!databaseService) {
    throw new Error('Workspace database not available in tool context.');
  }

  const db = databaseService.getDb();
  if (!isWorkspaceVfsDatabase(db)) {
    throw new Error('Workspace database connection does not expose the VFS database contract.');
  }

  return {
    db,
    projectId: readRequiredProjectId(context),
    conversationId: resolveToolConversationId(context),
    instanceId: resolveToolConversationInstanceId(context),
  };
}
