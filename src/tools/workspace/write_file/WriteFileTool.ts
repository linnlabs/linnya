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
import { appendCurrentTextMetrics } from '../shared/textMetricsObservation';

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
      created_folders: created.createdFolders.map(folder => ({
        locator: formatWorkspaceFileLocator(folder.path),
        inode: folder.inode,
      })),
      documentId: created.documentId,
      node: entry,
      ...(created.textMetrics ? { text_metrics: created.textMetrics } : {}),
    },
    appendDocumentDiagnosticsObservation(
      appendCurrentTextMetrics([
        created.buildObservation({ path: node.path, inode: entry.inode }),
        ...created.createdFolders.map(
          folder =>
            `已创建目录：${formatWorkspaceFileLocator(folder.path)}。inode: ${folder.inode}。`
        ),
      ].join('\n'), created.textMetrics),
      diagnostics
    )
  );
}

interface FileCreateTarget {
  readonly fileName: string;
  readonly parentPath: string;
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
  readonly argumentValidationErrorCode = 'WRITE_FILE_ARGUMENTS_INVALID';
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
      'Provide exactly one of locator or inode. New files require locator; inode can only identify an existing file.',
      `For new files, a missing extensionless path, .md, or .markdown creates Markdown${pluginHint ? `; ${pluginHint.slice(1)}` : ''}.`,
      'Missing intermediate Workspace folders are created automatically; created_folders lists the new folder locators and inodes. Existing files and read-only system views cannot be used as folders.',
      'Markdown writes are stored as pending revisions rather than directly replacing accepted document content.',
      'Markdown receipts count actual saved current text, including pending revisions and annotations: characters are Unicode code points including whitespace and punctuation; han_characters uses Unicode Script=Han. No need to paste the document into Shell to count it.',
      'Prefer edit_file for targeted changes. Use write_file when rewriting the whole file is intentional.',
      'Only workspace:/... locators are valid here. conversation:/... and file:///... belong to read_file and will be rejected.',
    ].join('\n');
  }

  private buildLocatorParameterDescription(): string {
    const pluginHint = buildEnabledPluginCreateHint();
    return `要写入的 Workspace locator，只能使用 workspace:/...。与 inode 二选一；新建文件只能传 locator，缺失的中间文件夹会自动创建。新建 Markdown 可用无后缀、.md 或 .markdown${pluginHint}。`;
  }

  // 模型目录使用各协议共有的顶层 object；互斥身份等跨字段规则由下方正式 admission 执行。
  // 顶层 oneOf 会被 Anthropic 拒绝，不能把执行校验的分支复制到模型输入 schema。
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      locator: {
        type: 'string',
        minLength: 1,
        description:
          '要写入的 Workspace locator。只能使用 workspace:/...；与 inode 二选一。新建文件只能传 locator，缺失的中间文件夹会自动创建。新建 Markdown 可用无后缀、.md 或 .markdown；插件文档格式由已启用插件贡献。',
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
      errorCode: this.argumentValidationErrorCode,
      toolName: this.name,
      example: { locator: 'workspace:/report.md', content: '# Report\n\nFull content' },
    });
  }

  getExecutionSummary(output: string): string {
    try {
      const parsed = WorkspaceWriteFileResultSchema.parse(JSON.parse(output));
      return `write_file：${parsed.data.locator}`;
    } catch {
      return 'write_file：结果格式异常，未能确认提交回执。';
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
          created_folders: [],
          documentId: node.id,
          node: toFileToolEntry(node),
          ...(write.textMetrics ? { text_metrics: write.textMetrics } : {}),
        },
        appendDocumentDiagnosticsObservation(
          appendCurrentTextMetrics(write.observation, write.textMetrics), diagnostics
        )
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

  private resolveFileCreateTarget(path?: string): FileCreateTarget | null {
    if (!path) return null;
    const segments = splitNormalizedVfsPath(path);
    const fileName = segments[segments.length - 1];
    if (!fileName) return null;
    return { fileName, parentPath: `/${segments.slice(0, -1).join('/')}` };
  }

  private async createMissingFile(params: {
    readonly path?: string;
    readonly content: string;
    readonly context: ToolContext;
    readonly runtime: ReturnType<typeof resolveWorkspaceFileToolRuntime>;
  }): Promise<string | null> {
    const target = this.resolveFileCreateTarget(params.path);
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
        parentPath: target.parentPath,
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
