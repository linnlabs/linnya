/**
 * @file workspaceRuntime.ts
 * @description 插件后端 workspace / database 宿主能力门面。
 *
 * 中文说明：
 * - 这些能力目前仍由 Linnya host 提供，插件包只通过明确契约入口依赖；
 * - 后续若要支持外部插件，可继续把这里的运行时能力拆成真正的注入式 port。
 */

import type { ToolContext } from 'src/tools/types';
import type Database from 'better-sqlite3';
import { resolveWorkspaceFileToolRuntime } from 'src/tools/workspace/shared/fileToolContext';
import { resolveWorkspaceVfsNode } from 'src/features/workspace/vfs/orchestration/resolveWorkspaceVfsNode';
import type { ResolveWorkspaceVfsNodeResult } from 'src/features/workspace/vfs/orchestration/resolveWorkspaceVfsNode';
import { pluginWorkspaceVfsNodeTypeAccessPolicy } from 'src/app-hosts/linnya/plugin-registry/pluginWorkspaceVfsNodeTypeAccessPolicy';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import type { Logger } from 'src/shared/logger';
import type { ConversationWorkDirectoryAdmissionPort } from 'src/app-hosts/linnya/application/conversation-lifecycle';
import { createWorkspaceMutationPublisher } from 'src/features/workspace/orchestration/workspaceMutationPublisherRegistry';
import { createWorkspaceDocumentUpdatedEvent } from 'src/features/workspace/functions/createWorkspaceDocumentMutationEvent';
import path from 'node:path';
import type {
  PluginLoggerConstructor,
  PluginLoggerPort,
  PluginWorkspaceDocumentUpdatedPayload,
  PluginToolVfsNodeResolveInput,
  PluginToolVfsNodeResolveResult,
  PluginWorkspaceServicePort,
  PluginConversationFilePathResolverPort,
} from '@linnya/plugin-host-contract/backend/workspaceRuntime';

export {
  WorkspaceService,
} from 'src/electron-main/services/workspace/workspace';

export type {
  PluginLoggerConstructor,
  PluginLoggerDetails,
  PluginLoggerPort,
  PluginSchemaProvider as ISchemaProvider,
  PluginToolResolvedVfsNode,
  PluginToolVfsNodeResolveInput,
  PluginToolVfsNodeResolveResult,
  PluginWorkspaceDocumentMutationKind,
  PluginWorkspaceDocumentUpdatedPayload,
  PluginWorkspaceRuntimeNode,
  PluginWorkspaceServicePort,
  PluginConversationFilePathResolverPort,
} from '@linnya/plugin-host-contract/backend/workspaceRuntime';

export function createConversationFilePathResolver(
  contextValue: unknown,
): PluginConversationFilePathResolverPort | undefined {
  if (!isToolContextLike(contextValue)) {
    return undefined;
  }
  const admission: ConversationWorkDirectoryAdmissionPort | undefined =
    contextValue.conversationWorkDirectoryAdmission;
  if (!admission) {
    return undefined;
  }
  return {
    resolveRelativePath: ({ conversationId, relativePath }) => admission.withAdmission(
      { conversationId },
      async directory => {
        const candidate = path.resolve(directory.absolutePath, relativePath);
        const relative = path.relative(directory.absolutePath, candidate);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new Error(`Conversation file path escapes the conversation workspace: ${relativePath}`);
        }
        return candidate;
      },
    ),
  };
}

type _WorkspaceServiceMatchesPluginPort = WorkspaceService extends PluginWorkspaceServicePort ? true : never;
type _LoggerMatchesPluginPort = Logger extends PluginLoggerPort ? true : never;
type _LoggerConstructorMatchesPluginContract = typeof Logger extends PluginLoggerConstructor ? true : never;

function isToolContextLike(value: unknown): value is ToolContext {
  return typeof value === 'object' && value !== null;
}

export function createWorkspaceService(db: Database.Database): PluginWorkspaceServicePort {
  return new WorkspaceService(db, {
    mutationPublisher: createWorkspaceMutationPublisher(),
  });
}

export { getWorkspaceDatabasePath } from './workspaceDatabasePath';

export function publishWorkspaceDocumentUpdated(payload: PluginWorkspaceDocumentUpdatedPayload): void {
  createWorkspaceMutationPublisher().publish(createWorkspaceDocumentUpdatedEvent({
    node: {
      id: payload.documentId,
      project_id: payload.projectId,
      type: payload.nodeType,
    },
    mutationKind: payload.mutationKind,
    ...(payload.versionNumber !== undefined ? { versionNumber: payload.versionNumber } : {}),
  }));
}

/**
 * 中文说明：
 * - 按 ToolContext 的 workspace 作用域（project / conversation / instance）把
 *   path 或 inode 解析成 VFS 节点，统一走平台级插件节点可见性策略；
 * - 插件包不需要也不允许知道 db 连接、access policy 的内部实现，只表达解析意图；
 * - context 收 unknown：插件侧 ToolContext 是 ambient 声明，无法在编译期与
 *   host ToolContext 同名，因此在门面边界做最小形状校验。
 */
export async function resolveWorkspaceVfsNodeForPluginTool(
  contextValue: unknown,
  input: PluginToolVfsNodeResolveInput,
): Promise<PluginToolVfsNodeResolveResult> {
  if (!isToolContextLike(contextValue)) {
    throw new Error('resolveWorkspaceVfsNodeForPluginTool requires ToolContext-like host object.');
  }
  const runtime = resolveWorkspaceFileToolRuntime(contextValue);
  return resolveWorkspaceVfsNode({
    db: runtime.db,
    projectId: runtime.projectId,
    conversationId: runtime.conversationId,
    instanceId: runtime.instanceId,
    nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
    path: input.path,
    inode: input.inode,
  });
}

export {
  Logger,
} from 'src/shared/logger';
export {
  saveWorkspaceNodeTextSnapshot,
} from 'src/features/workspace/infrastructure/sqlite/node-text-snapshot/nodeTextSnapshot.service';

const workspaceServiceContractCheck: _WorkspaceServiceMatchesPluginPort = true;
const loggerContractCheck: _LoggerMatchesPluginPort = true;
const loggerConstructorContractCheck: _LoggerConstructorMatchesPluginContract = true;
void workspaceServiceContractCheck;
void loggerContractCheck;
void loggerConstructorContractCheck;
