/**
 * @file EditFileTool.ts
 * @description 对 Workspace Path Layer 文件执行 exact string replacement。
 */

import { BaseTool, type ToolContext, type ToolParameterSchema } from '../../types';
import {
  WorkspaceEditFileArgsSchema,
  WorkspaceEditFileResultSchema,
  formatWorkspaceFileLocator,
  type WorkspaceEditFileResult,
} from '@app/schemas';
import { readWorkspaceVfsNode } from '../../../features/workspace/vfs/orchestration/readWorkspaceVfsNode';
import { resolveWorkspaceVfsNode } from '../../../features/workspace/vfs/orchestration/resolveWorkspaceVfsNode';
import { writeWorkspaceDocumentFile } from '../../../features/workspace/document-file-write/orchestration/writeWorkspaceDocumentFile';
import { createWorkspaceDocumentFileWriteProviderResolver } from '../../../app-hosts/linnya/adapters/document-file-write/createWorkspaceDocumentFileWriteProviderResolver';
import { ensureWorkspaceServiceToolContext } from '../shared/workspaceToolContext';
import { resolveWorkspaceFileToolRuntime } from '../shared/fileToolContext';
import { toFileToolEntry } from '../shared/fileToolOutput';
import { pluginWorkspaceVfsNodeTypeAccessPolicy } from '../../../app-hosts/linnya/plugin-registry/pluginWorkspaceVfsNodeTypeAccessPolicy';
import {
  listDocumentTypeBackendHooks,
  type DocumentTypeBackendHook,
} from '@plugin/backend/documentTypeBackendHook';
import {
  appendDocumentDiagnosticsObservation,
  renderDocumentDiagnostics,
} from '../shared/documentDiagnostics';
import { workspacePathFromLocator } from '../shared/workspaceFileLocator';
import { validateWorkspaceFileToolArguments } from '../shared/workspaceFileToolContract';
import { applyExactTextReplacement } from '../../../features/workspace/document-file-write/functions/applyExactTextReplacement';

const MAX_EDIT_SOURCE_CHARS = 1_500_000;
const MAX_VISIBLE_EDIT_CHANGES = 50;

function serializeEditFileResult(
  data: WorkspaceEditFileResult['data'],
  observation: string
): string {
  return JSON.stringify(WorkspaceEditFileResultSchema.parse({ data, observation }), null, 2);
}

function listHookFileExtensions(hook: DocumentTypeBackendHook): string[] {
  const extensions = [
    ...(typeof hook.fileExtension === 'string' ? [hook.fileExtension] : []),
    ...(hook.fileExtensions ?? []),
  ]
    .map(extension => extension.trim().toLowerCase())
    .filter(extension => extension.length > 0);
  return Array.from(new Set(extensions));
}

function formatExtensions(extensions: readonly string[]): string {
  return extensions.join('、');
}

function buildEnabledPluginEditHint(): string {
  const pluginParts = listDocumentTypeBackendHooks()
    .filter(hook => hook.writeDocument)
    .map(hook => {
      const extensions = listHookFileExtensions(hook);
      return extensions.length > 0
        ? `${hook.displayName} 使用 ${formatExtensions(extensions)}`
        : '';
    })
    .filter(part => part.length > 0);
  return pluginParts.length > 0 ? `；${pluginParts.join('；')}` : '';
}

export class EditFileTool extends BaseTool {
  readonly name = 'edit_file';
  readonly idempotency = { scope: 'conversation' } as const;
  /**
   * 工具名确定后立即建立 loading 卡片；精确替换正文不参与前端增量展示。
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
    const pluginHint = buildEnabledPluginEditHint();
    return [
      'Performs exact string replacements in a Workspace project file using Linnya paths.',
      'Use read_file first, then pass an exact old_string from the current file content.',
      `Supports existing Markdown documents and enabled plugin-owned document files. Use write_file to create new files: Markdown accepts no suffix, .md, or .markdown${pluginHint}.`,
      'Markdown edits are written as pending revisions so the user can accept or reject them in the editor.',
      'The edit will fail if old_string is not unique unless replace_all=true.',
      'Success returns changed line ranges and a compact unified diff; stale or ambiguous input returns reread hints.',
    ].join('\n');
  }

  private buildLocatorParameterDescription(): string {
    return `要编辑的已有 Workspace locator。与 inode 二选一。Markdown 文件可以是无后缀、.md 或 .markdown${buildEnabledPluginEditHint()}。`;
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      locator: {
        type: 'string',
        minLength: 1,
        description:
          '要编辑的已有 Workspace locator。与 inode 二选一。Markdown 文件可以是无后缀、.md 或 .markdown；插件文档格式由已启用插件贡献。',
      },
      inode: {
        type: 'string',
        minLength: 1,
        description: '已有 Workspace 节点的稳定 inode。与 locator 二选一。',
      },
      old_string: {
        type: 'string',
        minLength: 1,
        description: '要替换的精确原文。',
      },
      new_string: {
        type: 'string',
        description: '替换后的文本。',
      },
      replace_all: {
        type: 'boolean',
        default: false,
        description: '是否替换所有匹配项。默认 false。',
      },
    },
    required: ['old_string', 'new_string'],
    oneOf: [
      {
        type: 'object',
        properties: {
          locator: {
            type: 'string',
            minLength: 1,
            description: '要编辑的已有 Workspace locator。',
          },
          old_string: { type: 'string', minLength: 1, description: '要替换的精确原文。' },
          new_string: { type: 'string', description: '替换后的文本。' },
          replace_all: { type: 'boolean', default: false, description: '是否替换所有匹配项。' },
        },
        required: ['locator', 'old_string', 'new_string'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          inode: { type: 'string', minLength: 1, description: '已有 Workspace 节点的稳定 inode。' },
          old_string: { type: 'string', minLength: 1, description: '要替换的精确原文。' },
          new_string: { type: 'string', description: '替换后的文本。' },
          replace_all: { type: 'boolean', default: false, description: '是否替换所有匹配项。' },
        },
        required: ['inode', 'old_string', 'new_string'],
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
      schema: WorkspaceEditFileArgsSchema,
      errorCode: 'EDIT_FILE_ARGUMENTS_INVALID',
      toolName: this.name,
    });
  }

  getExecutionSummary(output: string): string {
    try {
      const parsed = WorkspaceEditFileResultSchema.parse(JSON.parse(output));
      return `edit_file：${parsed.data.locator}，替换 ${parsed.data.replaced} 处`;
    } catch {
      return 'edit_file：完成。';
    }
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const parsedArgs = WorkspaceEditFileArgsSchema.parse(args);
    const { locator, inode } = parsedArgs;
    const path = locator ? workspacePathFromLocator(locator) : undefined;
    const oldString = parsedArgs.old_string;
    const newString = parsedArgs.new_string;

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
      throw new Error(resolved.hint ? `${resolved.message} ${resolved.hint}` : resolved.message);
    }
    const node = resolved.node;
    const read = await readWorkspaceVfsNode({
      db: runtime.db,
      projectId: runtime.projectId,
      conversationId: runtime.conversationId,
      instanceId: runtime.instanceId,
      inode: node.inode,
      maxChars: MAX_EDIT_SOURCE_CHARS + 1,
      nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
    });
    if (!read.ok) {
      throw new Error(read.hint ? `${read.message} ${read.hint}` : read.message);
    }
    if (read.truncated) {
      throw new Error(
        '文件过大，edit_file 无法安全执行全文 exact replacement。请先缩小文件或使用更小范围的专用编辑能力。'
      );
    }

    const replacement = applyExactTextReplacement({
      source: read.text,
      oldString,
      newString,
      replaceAll: parsedArgs.replace_all,
    });

    const databaseService = context.databaseService;
    if (!databaseService) {
      throw new Error('Workspace database not available in tool context.');
    }
    const resolvedContext = ensureWorkspaceServiceToolContext(context);
    const expectedSourceKey = readMetadataString(read.metadata, 'sourceKey');
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
        content: replacement.text,
        operation: 'edit',
        replacedCount: replacement.count,
        ...(expectedSourceKey ? { expectedSourceKey } : {}),
      },
      resolveProvider: createWorkspaceDocumentFileWriteProviderResolver({
        db: databaseService.getDb(),
        context: resolvedContext.context,
        ...(context.workspaceMutationPublisher
          ? { mutationPublisher: context.workspaceMutationPublisher }
          : {}),
      }),
    });
    const renderedDiagnostics = renderDocumentDiagnostics(write.diagnostics);
    const visibleChanges = replacement.changes.slice(0, MAX_VISIBLE_EDIT_CHANGES);
    const changesTruncatedCount = replacement.changes.length - visibleChanges.length;

    const data: WorkspaceEditFileResult['data'] = {
      ...renderedDiagnostics.data,
      source_kind: 'workspace_vfs',
      locator: formatWorkspaceFileLocator(node.path),
      inode: node.inode,
      documentId: node.id,
      node: toFileToolEntry(node),
      replaced: replacement.count,
      changes: visibleChanges,
      ...(changesTruncatedCount > 0 ? { changesTruncatedCount } : {}),
      diff: replacement.diff,
      ...(replacement.diffTruncated ? { diffTruncated: true } : {}),
    };

    return serializeEditFileResult(
      data,
      appendDocumentDiagnosticsObservation(write.observation, renderedDiagnostics)
    );
  }
}

function readMetadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string
): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
