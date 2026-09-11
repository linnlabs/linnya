/**
 * @file WriteFileTool.ts
 * @description 对 Workspace Path Layer 文件执行全文写入。
 */

import { BaseTool, type ToolContext, type ToolParameterSchema } from '../../types';
import {
  WorkspaceWriteFileArgsSchema,
  WorkspaceWriteFileResultSchema,
  formatWorkspaceFileLocator,
  type WorkspaceWriteFileResult,
} from '@app/schemas';
import { resolveWorkspaceVfsNode } from '../../../features/workspace/vfs/orchestration/resolveWorkspaceVfsNode';
import { writeWorkspaceDocumentFile } from '../../../features/workspace/document-file-write/orchestration/writeWorkspaceDocumentFile';
import { createWorkspaceDocumentFile } from '../../../features/workspace/document-file-create/orchestration/createWorkspaceDocumentFile';
import { createWorkspaceDocumentFileWriteProviderResolver } from '../../../app-hosts/linnya/adapters/document-file-write/createWorkspaceDocumentFileWriteProviderResolver';
import {
  createWorkspaceDocumentFileCreateProviderResolver,
  listWorkspaceDocumentFileCreateFormats,
} from '../../../app-hosts/linnya/adapters/document-file-create/createWorkspaceDocumentFileCreateProviderResolver';
import { splitNormalizedVfsPath } from '../../../features/workspace/vfs/functions/pathSegments';
import { resolveWorkspaceFileToolRuntime } from '../shared/fileToolContext';
import { toFileToolEntry } from '../shared/fileToolOutput';
import { ensureWorkspaceServiceToolContext } from '../shared/workspaceToolContext';
import { pluginWorkspaceVfsNodeTypeAccessPolicy } from '../../../app-hosts/linnya/plugin-registry/pluginWorkspaceVfsNodeTypeAccessPolicy';
import {
  appendDocumentDiagnosticsObservation,
  renderDocumentDiagnostics,
} from '../shared/documentDiagnostics';
import { workspacePathFromLocator } from '../shared/workspaceFileLocator';
import { validateWorkspaceFileToolArguments } from '../shared/workspaceFileToolContract';
import { createFileToolResultCommit } from '../shared/fileToolRecovery';
import { readPersistedWorkspaceVfsNode } from '../../../features/workspace/vfs';
import type { WorkspaceVfsNode } from '../../../features/workspace/vfs/definitions/workspaceVfsNode';
import type { WorkspaceDocumentFileCreateResult } from '../../../features/workspace/document-file-create/definitions/workspaceDocumentFileCreate';
import type { WorkspaceDocumentFileWriteResult } from '../../../features/workspace/document-file-write/definitions/workspaceDocumentFileWrite';

function serializeWriteFileResult(
  data: WorkspaceWriteFileResult['data'],
  observation: string
): string {
  return JSON.stringify(WorkspaceWriteFileResultSchema.parse({ data, observation }), null, 2);
}

function serializeCreatedFileResult(
  created: WorkspaceDocumentFileCreateResult,
  node: WorkspaceVfsNode
): string {
  const entry = toFileToolEntry(node);
  const diagnostics = renderDocumentDiagnostics(created.diagnostics);
  return serializeWriteFileResult(
    {
      ...diagnostics.data,
      source_kind: 'workspace_vfs',
      locator: formatWorkspaceFileLocator(node.path),
      inode: entry.inode,
      operation: 'create',
      documentId: created.documentId,
      node: entry,
    },
    appendDocumentDiagnosticsObservation(
      created.buildObservation({ path: node.path, inode: entry.inode }),
      diagnostics
    )
  );
}

interface FileCreateTarget {
  readonly fileName: string;
  readonly parentId?: string;
}

function readFileExtension(fileName: string): string | null {
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex <= 0 || lastDotIndex >= fileName.length - 1) {
    return null;
  }
  return fileName.slice(lastDotIndex).toLowerCase();
}

function buildCreatePathHint(path?: string): string {
  const prefix = path ? `Path not found: ${path}. ` : '';
  const pluginHint = buildEnabledPluginCreateHint();
  return [prefix, `新建文件时，Markdown 使用无后缀路径、.md 或 .markdown${pluginHint}。`].join('');
}

function formatExtensions(extensions: readonly string[]): string {
  return extensions.join('、');
}

function buildEnabledPluginCreateHint(): string {
  const pluginParts = listWorkspaceDocumentFileCreateFormats().map(
    format => `${format.displayName} 使用 ${formatExtensions(format.extensions)}`
  );
  return pluginParts.length > 0 ? `；${pluginParts.join('；')}` : '';
}

export class WriteFileTool extends BaseTool {
  readonly name = 'write_file';
  // 覆盖写入依赖文件当前状态；A → B → A 必须真正写回 A，不能命中历史 A 的结果。
  /**
   * 只要模型已经确定要写文件，就先让 Renderer 建立 loading 卡片。
   * 正文可能很大，标题也不依赖正文，因此不发送参数增量快照。
   */
  readonly streaming = {
    emitPlaceholder: true,
  } as const;

  get description() {
    return this.buildDescription();
  }

  getDescriptionForContext(): string {
    return this.buildDescription();
  }

  private buildDescription(): string {
    const pluginHint = buildEnabledPluginCreateHint();
    return [
      'Writes full content to a Workspace project file using Linnya paths.',
      'Supports Markdown documents and enabled plugin-owned document files.',
      `For new files, a missing extensionless path, .md, or .markdown creates Markdown${pluginHint ? `; ${pluginHint.slice(1)}` : ''}.`,
      'Markdown writes are stored as pending revisions rather than directly replacing accepted document content.',
      'Prefer edit_file for targeted changes. Use write_file when rewriting the whole file is intentional.',
    ].join('\n');
  }

  private buildLocatorParameterDescription(): string {
    const pluginHint = buildEnabledPluginCreateHint();
    return `要写入的 Workspace locator。与 inode 二选一；新建文件只能传 locator。新建 Markdown 可用无后缀、.md 或 .markdown${pluginHint}。`;
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      locator: {
        type: 'string',
        minLength: 1,
        description:
          '要写入的 Workspace locator。与 inode 二选一；新建文件只能传 locator。新建 Markdown 可用无后缀、.md 或 .markdown；插件文档格式由已启用插件贡献。',
      },
      inode: {
        type: 'string',
        minLength: 1,
        description: '已有 Workspace 节点的稳定 inode。与 locator 二选一；新建文件不能传 inode。',
      },
      content: {
        type: 'string',
        description: '要写入的完整文件内容。',
      },
    },
    required: ['content'],
    // 封闭分支确保新建/按路径写入与按 inode 更新不会形成两个竞争权威。
    oneOf: [
      {
        type: 'object',
        properties: {
          locator: { type: 'string', minLength: 1, description: '要写入的 Workspace locator。' },
          content: { type: 'string', description: '要写入的完整文件内容。' },
        },
        required: ['locator', 'content'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          inode: { type: 'string', minLength: 1, description: '已有 Workspace 节点的稳定 inode。' },
          content: { type: 'string', description: '要写入的完整文件内容。' },
        },
        required: ['inode', 'content'],
        additionalProperties: false,
      },
    ],
  };

  getParametersForContext(): ToolParameterSchema {
    return {
      ...this.parameters,
      properties: {
        ...this.parameters.properties,
        locator: {
          type: 'string',
          minLength: 1,
          description: this.buildLocatorParameterDescription(),
        },
      },
    };
  }

  protected override validateArguments(args: Record<string, unknown>): {
    success: boolean;
    error?: string;
  } {
    return validateWorkspaceFileToolArguments({
      args,
      schema: WorkspaceWriteFileArgsSchema,
      errorCode: 'WRITE_FILE_ARGUMENTS_INVALID',
      toolName: this.name,
    });
  }

  getExecutionSummary(output: string): string {
    try {
      const parsed = WorkspaceWriteFileResultSchema.parse(JSON.parse(output));
      return `write_file：${parsed.data.locator}`;
    } catch {
      return 'write_file：完成。';
    }
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const { locator, inode, content } = WorkspaceWriteFileArgsSchema.parse(args);
    const path = locator ? workspacePathFromLocator(locator) : undefined;

    const runtime = resolveWorkspaceFileToolRuntime(context);
    const resolved = await resolveWorkspaceVfsNode({
      db: runtime.db,
      projectId: runtime.projectId,
      conversationId: runtime.conversationId,
      instanceId: runtime.instanceId,
      nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
      ...(inode ? { inode } : { path }),
    });
    if (!resolved.ok) {
      const created = inode
        ? undefined
        : await this.createMissingFile({
            path,
            content,
            context,
            runtime,
          });
      if (created) return created;
      const resolvedMessage = resolved.hint
        ? `${resolved.message} ${resolved.hint}`
        : resolved.message;
      throw new Error(path ? `${resolvedMessage} ${buildCreatePathHint(path)}` : resolvedMessage);
    }
    const node = resolved.node;
    const databaseService = context.databaseService;
    if (!databaseService) {
      throw new Error('Workspace database not available in tool context.');
    }
    const db = databaseService.getDb();
    const resolvedContext = ensureWorkspaceServiceToolContext(context);
    const serialize = (write: WorkspaceDocumentFileWriteResult): string => {
      const diagnostics = renderDocumentDiagnostics(write.diagnostics);
      return serializeWriteFileResult(
        {
          ...diagnostics.data,
          source_kind: 'workspace_vfs',
          locator: formatWorkspaceFileLocator(node.path),
          inode: node.inode,
          operation: 'update',
          documentId: node.id,
          node: toFileToolEntry(node),
        },
        appendDocumentDiagnosticsObservation(write.observation, diagnostics)
      );
    };
    const write = await writeWorkspaceDocumentFile({
      request: {
        identity: {
          documentId: node.id,
          documentName: node.name,
          documentType: node.type,
          projectId: runtime.projectId,
          path: node.path,
          inode: node.inode,
        },
        content,
        operation: 'write',
      },
      resolveProvider: createWorkspaceDocumentFileWriteProviderResolver({
        db,
        context: resolvedContext.context,
        resultCommit: createFileToolResultCommit(context, this.name, serialize),
        ...(context.workspaceMutationPublisher
          ? { mutationPublisher: context.workspaceMutationPublisher }
          : {}),
      }),
    });
    return serialize(write);
  }

  private async resolveFileCreateTarget(params: {
    readonly path?: string;
    readonly runtime: ReturnType<typeof resolveWorkspaceFileToolRuntime>;
  }): Promise<FileCreateTarget | null> {
    if (!params.path) {
      return null;
    }

    const segments = splitNormalizedVfsPath(params.path);
    if (segments.length === 0) {
      return null;
    }

    const fileName = segments[segments.length - 1];
    if (!fileName) {
      return null;
    }

    if (segments.length === 1) {
      return {
        fileName,
      };
    }

    const parentPath = `/${segments.slice(0, -1).join('/')}`;
    const parent = await resolveWorkspaceVfsNode({
      db: params.runtime.db,
      projectId: params.runtime.projectId,
      conversationId: params.runtime.conversationId,
      instanceId: params.runtime.instanceId,
      path: parentPath,
      nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
    });
    if (!parent.ok) {
      throw new Error(parent.hint ? `${parent.message} ${parent.hint}` : parent.message);
    }
    if (parent.node.type !== 'folder') {
      throw new Error(`write_file 只能在文件夹下新建文件：${parentPath}`);
    }
    if (parent.node.is_virtual) {
      throw new Error(`write_file 不能在虚拟系统目录下新建文件：${parentPath}`);
    }

    return {
      fileName,
      parentId: parent.node.id,
    };
  }

  private async createMissingFile(params: {
    readonly path?: string;
    readonly content: string;
    readonly context: ToolContext;
    readonly runtime: ReturnType<typeof resolveWorkspaceFileToolRuntime>;
  }): Promise<string | null> {
    const target = await this.resolveFileCreateTarget(params);
    if (!target) return null;

    const context = params.context;
    const databaseService = context.databaseService;
    if (!databaseService) {
      throw new Error('Workspace database not available in tool context.');
    }
    const db = databaseService.getDb();
    const resolvedContext = ensureWorkspaceServiceToolContext(context);
    const createResult = await createWorkspaceDocumentFile({
      request: {
        projectId: params.runtime.projectId,
        parentId: target.parentId ?? null,
        name: target.fileName,
        content: params.content,
      },
      resolveProvider: createWorkspaceDocumentFileCreateProviderResolver({
        db,
        context: resolvedContext.context,
        workspaceService: resolvedContext.workspaceService,
        resultCommit: createFileToolResultCommit(
          context,
          this.name,
          (created: WorkspaceDocumentFileCreateResult) => {
            const node = readPersistedWorkspaceVfsNode(db, created.documentId);
            if (!node) throw new Error('Created document has no committed Workspace identity');
            return serializeCreatedFileResult(created, node);
          }
        ),
      }),
    });
    if (!createResult) {
      const extension = readFileExtension(target.fileName);
      if (extension) {
        throw new Error(`不支持的文件格式：${extension}。${buildCreatePathHint()}`);
      }
      return null;
    }

    const created = await resolveWorkspaceVfsNode({
      db: params.runtime.db,
      projectId: params.runtime.projectId,
      conversationId: params.runtime.conversationId,
      instanceId: params.runtime.instanceId,
      inode: `workspace:${createResult.documentId}`,
      nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
    });
    if (!created.ok) {
      // provider 已经提交创建事实后，VFS 必须能定位同一节点；这里不能伪造 path/inode。
      const resolvedMessage = created.hint ? `${created.message} ${created.hint}` : created.message;
      throw new Error(
        `已创建文档，但无法在当前工作区定位新节点 ${createResult.documentId}：${resolvedMessage}`
      );
    }

    return serializeCreatedFileResult(createResult, created.node);
  }
}
