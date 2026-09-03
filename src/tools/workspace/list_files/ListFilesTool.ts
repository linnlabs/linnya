/**
 * @file ListFilesTool.ts
 * @description 按 Workspace Path Layer 列出当前项目目录。
 */

import { BaseTool, type ToolContext, type ToolParameterSchema } from '../../types';
import {
  WorkspaceListFilesArgsSchema,
  WorkspaceListFilesResultSchema,
  formatWorkspaceFileLocator,
  type WorkspaceListFilesResult,
} from '@app/schemas';
import type { WorkspaceVfsNode } from '../../../features/workspace/vfs/definitions/workspaceVfsNode';
import { listWorkspaceVfsNodes } from '../../../features/workspace/vfs/orchestration/listWorkspaceVfsNodes';
import { resolveWorkspaceVfsNode } from '../../../features/workspace/vfs/orchestration/resolveWorkspaceVfsNode';
import { normalizeVfsPath } from '../../../features/workspace/vfs/functions/pathSegments';
import { resolveWorkspaceFileToolRuntime } from '../shared/fileToolContext';
import {
  formatEntriesObservation,
  toDocumentAlias,
  toFileToolEntry,
} from '../shared/fileToolOutput';
import { pluginWorkspaceVfsNodeTypeAccessPolicy } from '../../../app-hosts/linnya/plugin-registry/pluginWorkspaceVfsNodeTypeAccessPolicy';
import { workspacePathFromLocator } from '../shared/workspaceFileLocator';
import { validateWorkspaceFileToolArguments } from '../shared/workspaceFileToolContract';

function paginate<T>(
  items: readonly T[],
  offset: number,
  limit: number
): {
  readonly page: T[];
  readonly hasMore: boolean;
} {
  return {
    page: items.slice(offset, offset + limit),
    hasMore: offset + limit < items.length,
  };
}

export class ListFilesTool extends BaseTool {
  readonly name = 'list_files';

  get description() {
    return [
      'List files and folders in the current Workspace project using Linnya Workspace Path Layer paths.',
      'This is the preferred ls-like tool for the project file tree. It preserves the user-created folder structure and does not expose KnowledgeBase as project files.',
      'Use locator="workspace:/" for the project root. Reuse returned locator or inode with read_file.',
      'Hidden system views under /.linnya are only listed when include_system_nodes=true.',
    ].join('\n');
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      locator: {
        type: 'string',
        minLength: 1,
        description: '要列出的 Workspace locator。省略 locator/inode 时表示项目根目录。',
      },
      inode: {
        type: 'string',
        minLength: 1,
        description: '已有 Workspace 节点的稳定 inode。与 locator 二选一。',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 200,
        default: 80,
        description: '最多返回条目数，默认 80，最大 200。',
      },
      offset: {
        type: 'integer',
        minimum: 0,
        default: 0,
        description: '分页偏移，默认 0。',
      },
      include_system_nodes: {
        type: 'boolean',
        default: false,
        description: '是否列出 .linnya 只读系统视图。默认 false。',
      },
    },
    required: [],
    additionalProperties: false,
    // 分支重复是刻意的：provider 必须看到封闭 oneOf，开发者仍可在上方一眼查看完整参数。
    oneOf: [
      {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 200,
            default: 80,
            description: '最多返回条目数。',
          },
          offset: { type: 'integer', minimum: 0, default: 0, description: '分页偏移。' },
          include_system_nodes: {
            type: 'boolean',
            default: false,
            description: '是否列出系统视图。',
          },
        },
        required: [],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          locator: { type: 'string', minLength: 1, description: '要列出的 Workspace locator。' },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 200,
            default: 80,
            description: '最多返回条目数。',
          },
          offset: { type: 'integer', minimum: 0, default: 0, description: '分页偏移。' },
          include_system_nodes: {
            type: 'boolean',
            default: false,
            description: '是否列出系统视图。',
          },
        },
        required: ['locator'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          inode: { type: 'string', minLength: 1, description: '已有 Workspace 节点的稳定 inode。' },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 200,
            default: 80,
            description: '最多返回条目数。',
          },
          offset: { type: 'integer', minimum: 0, default: 0, description: '分页偏移。' },
          include_system_nodes: {
            type: 'boolean',
            default: false,
            description: '是否列出系统视图。',
          },
        },
        required: ['inode'],
        additionalProperties: false,
      },
    ],
  };

  protected override validateArguments(args: Record<string, unknown>): {
    success: boolean;
    error?: string;
  } {
    return validateWorkspaceFileToolArguments({
      args,
      schema: WorkspaceListFilesArgsSchema,
      errorCode: 'LIST_FILES_ARGUMENTS_INVALID',
      toolName: this.name,
    });
  }

  getExecutionSummary(output: string): string {
    try {
      const parsed = JSON.parse(output) as { data?: { locator?: unknown; total_count?: unknown } };
      const locator =
        typeof parsed.data?.locator === 'string' ? parsed.data.locator : 'workspace:/';
      const total = typeof parsed.data?.total_count === 'number' ? parsed.data.total_count : 0;
      return `list_files：${locator}，${total} 项`;
    } catch {
      return 'list_files：完成。';
    }
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const parsedArgs = WorkspaceListFilesArgsSchema.parse(args);

    const runtime = resolveWorkspaceFileToolRuntime(context);
    const includeSystemNodes = parsedArgs.include_system_nodes;
    const inode = parsedArgs.inode;
    const limit = parsedArgs.limit;
    const offset = parsedArgs.offset;
    const normalizedPath = normalizeVfsPath(
      parsedArgs.locator ? workspacePathFromLocator(parsedArgs.locator) : '/'
    );

    let target: WorkspaceVfsNode | null = null;
    let listPath = '/';
    if (inode || (normalizedPath && normalizedPath !== '/')) {
      const resolved = await resolveWorkspaceVfsNode({
        db: runtime.db,
        projectId: runtime.projectId,
        conversationId: runtime.conversationId,
        instanceId: runtime.instanceId,
        includeSystemNodes,
        nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
        ...(inode ? { inode } : { path: normalizedPath }),
      });
      if (!resolved.ok) {
        throw new Error(resolved.hint ? `${resolved.message} ${resolved.hint}` : resolved.message);
      }
      target = resolved.node;
      listPath = target.path;
    } else {
      // 根路径不是一个可解析的 VFS 节点；它表示“列出 parentId=null 的项目根”。
      listPath = '/';
    }

    const allChildren =
      target && target.type !== 'folder'
        ? [target]
        : await listWorkspaceVfsNodes({
            db: runtime.db,
            projectId: runtime.projectId,
            parentId: target?.id ?? null,
            conversationId: runtime.conversationId,
            instanceId: runtime.instanceId,
            includeSystemNodes,
            nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
          });

    const { page, hasMore } = paginate(allChildren, offset, limit);
    const entries = page.map(toFileToolEntry);
    const data: WorkspaceListFilesResult['data'] = {
      source_kind: 'workspace_vfs',
      locator: formatWorkspaceFileLocator(listPath),
      ...(target ? { inode: target.inode } : {}),
      ...(target && target.type === 'folder' ? { parent_inode: target.inode } : {}),
      entries,
      documents: page.map(toDocumentAlias),
      total_count: allChildren.length,
      offset,
      has_more: hasMore,
      include_system_nodes: includeSystemNodes,
    };

    const result = WorkspaceListFilesResultSchema.parse({
      data,
      observation: formatEntriesObservation({
        label: `Files ${listPath}`,
        entries,
        totalCount: allChildren.length,
        offset,
        hasMore,
      }),
    });

    return JSON.stringify(result, null, 2);
  }
}
