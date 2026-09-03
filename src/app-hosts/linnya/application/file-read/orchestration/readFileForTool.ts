import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatWorkspaceFileLocator,
  parseFileLocator,
  WorkspaceReadFileResultSchema,
  type WorkspaceReadFileArgs,
  type WorkspaceReadFileResult,
} from '@app/schemas';
import { pluginWorkspaceVfsNodeTypeAccessPolicy } from 'src/app-hosts/linnya/plugin-registry/pluginWorkspaceVfsNodeTypeAccessPolicy';
import { requireCitationRefAllocator, requireCitationSequenceOffset } from 'src/domains/citation';
import { buildDocumentCitationWindowOutput } from 'src/features/workspace/document-read/orchestration/buildDocumentCitationWindowOutput';
import { readWorkspaceVfsNode } from 'src/features/workspace/vfs/orchestration/readWorkspaceVfsNode';
import { resolveWorkspaceVfsNode } from 'src/features/workspace/vfs/orchestration/resolveWorkspaceVfsNode';
import { buildReadFileCitationFields } from 'src/tools/workspace/read_file/functions/buildReadFileCitationFields';
import { readWorkspaceDocumentForTool } from 'src/tools/workspace/read_file/workspaceDocumentReadAdapter';
import { resolveWorkspaceFileToolRuntime } from 'src/tools/workspace/shared/fileToolContext';
import { toFileToolEntry } from 'src/tools/workspace/shared/fileToolOutput';
import type { ToolContext } from 'src/tools/types';
import { PhysicalFileReadError } from '../definitions/physicalFileRead';
import { hasRunImageAttachment } from '../functions/hasRunImageAttachment';
import { remapWorkspaceCitationRefs } from '../functions/remapWorkspaceCitationRefs';
import { readPhysicalFileForTool } from './readPhysicalFileForTool';

function sliceTextWindow(
  text: string,
  offset: number,
  limit: number
): {
  readonly text: string;
  readonly hasMore: boolean;
  readonly nextOffset?: number;
} {
  const end = offset + limit;
  const sliced = text.slice(offset, end);
  const hasMore = text.length > end;
  return { text: sliced, hasMore, ...(hasMore ? { nextOffset: end } : {}) };
}

function formatReadFileObservation(params: {
  readonly locator: string;
  readonly text: string;
  readonly offset: number;
  readonly nextOffset?: number;
  readonly supplement?: string;
}): string {
  const content = (() => {
    if (params.text.length === 0) {
      return params.offset === 0
        ? `[read_file: ${params.locator} 为空]`
        : `[read_file: offset=${params.offset} 已到 ${params.locator} 文件末尾]`;
    }
    if (params.text.trim().length === 0) {
      return `${params.text}\n[read_file: 当前窗口只包含空白字符]`;
    }
    return params.text;
  })();
  const visibleContent = params.supplement ? `${content}\n\n${params.supplement}` : content;
  return params.nextOffset === undefined
    ? visibleContent
    : `${visibleContent}\n\n[read_file: 还有更多内容，继续使用 offset=${params.nextOffset}]`;
}

function requirePhysicalReadDependencies(context: ToolContext): {
  readonly reader: NonNullable<ToolContext['physicalFileReader']>;
  readonly imageIngress: NonNullable<ToolContext['managedImageIngress']>;
  readonly claims: NonNullable<ToolContext['toolResultAssetClaims']>;
  readonly conversationId: string;
  readonly toolCallId: string;
} {
  const conversationId = context.conversationId?.trim();
  const toolCallId = context.parentToolCallId;
  if (
    !context.physicalFileReader ||
    !context.managedImageIngress ||
    !context.toolResultAssetClaims ||
    !conversationId ||
    !toolCallId
  ) {
    throw new Error('[READ_FILE_PHYSICAL_CONTEXT_MISSING] 物理文件读取上下文不完整。');
  }
  return {
    reader: context.physicalFileReader,
    imageIngress: context.managedImageIngress,
    claims: context.toolResultAssetClaims,
    conversationId,
    toolCallId,
  };
}

async function readPhysicalLocator(input: {
  readonly parsedLocator: Extract<
    ReturnType<typeof parseFileLocator>,
    { kind: 'conversation' | 'file' }
  >;
  readonly args: WorkspaceReadFileArgs;
  readonly rawArgs: Readonly<Record<string, unknown>>;
  readonly context: ToolContext;
}): Promise<string> {
  const deps = requirePhysicalReadDependencies(input.context);
  const hasAttachedImageContent = (sha256: string): boolean => {
    const { runId, conversationView } = input.context;
    return (
      runId !== undefined &&
      conversationView !== undefined &&
      hasRunImageAttachment(conversationView.getWorkingHistoryEvents(), runId, sha256)
    );
  };
  const hasExplicitTextWindow = ['offset', 'limit'].some(key =>
    Object.prototype.hasOwnProperty.call(input.rawArgs, key)
  );
  const read = await (async () => {
    if (input.parsedLocator.kind === 'conversation') {
      const conversationLocator = input.parsedLocator;
      const admission = input.context.conversationWorkDirectoryAdmission;
      if (!admission) {
        throw new Error(
          '[READ_FILE_CONVERSATION_CONTEXT_MISSING] conversation 工作目录准入上下文不完整。'
        );
      }
      return admission.withAdmission({ conversationId: deps.conversationId }, directory =>
        readPhysicalFileForTool({
          ...deps,
          locator: conversationLocator.locator,
          absolutePath: path.resolve(
            directory.absolutePath,
            ...conversationLocator.relativePath.split('/')
          ),
          scope: { kind: 'conversation', rootPath: directory.absolutePath },
          hasExplicitTextWindow,
          hasAttachedImageContent,
        })
      );
    }
    let absolutePath: string;
    try {
      absolutePath = fileURLToPath(input.parsedLocator.url);
    } catch (error: unknown) {
      throw new PhysicalFileReadError(
        'READ_FILE_LOCATOR_INVALID',
        `file locator 无法转换为当前平台的绝对路径：${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
    if (absolutePath.includes('\0')) {
      throw new PhysicalFileReadError('READ_FILE_LOCATOR_INVALID', 'file locator 解码后包含 NUL。');
    }
    return readPhysicalFileForTool({
      ...deps,
      locator: input.parsedLocator.locator,
      absolutePath,
      scope: { kind: 'host' },
      hasExplicitTextWindow,
      hasAttachedImageContent,
    });
  })();

  const sourceKind =
    input.parsedLocator.kind === 'conversation'
      ? ('conversation_file' as const)
      : ('host_file' as const);
  if (read.kind === 'image') {
    const attached = read.attachmentStatus === 'attached';
    return JSON.stringify(
      WorkspaceReadFileResultSchema.parse({
        data: {
          source_kind: sourceKind,
          locator: read.locator,
          file_name: read.fileName,
          content_type: read.contentType,
          byte_length: read.byteLength,
          width: read.width,
          height: read.height,
          attachment_status: read.attachmentStatus,
        },
        observation: attached
          ? '已读取图片文件；真实像素已附加到本次工具结果。'
          : '已读取图片文件；相同像素已在当前 run 的模型上下文中，本次未重复附加。',
        ...(attached ? { modelInput: { attachments: [read.selection] } } : {}),
      }),
      null,
      2
    );
  }

  const window = sliceTextWindow(read.text, input.args.offset, input.args.limit);
  return JSON.stringify(
    WorkspaceReadFileResultSchema.parse({
      data: {
        source_kind: sourceKind,
        locator: read.locator,
        file_name: read.fileName,
        content_type: read.contentType,
        byte_length: read.byteLength,
        offset: input.args.offset,
        limit: input.args.limit,
        truncated: false,
        has_more: window.hasMore,
        ...(window.nextOffset !== undefined ? { next_offset: window.nextOffset } : {}),
      },
      observation: formatReadFileObservation({
        locator: read.locator,
        text: window.text,
        offset: input.args.offset,
        ...(window.nextOffset !== undefined ? { nextOffset: window.nextOffset } : {}),
      }),
    }),
    null,
    2
  );
}

async function resolveWorkspaceIdentity(input: {
  readonly args: WorkspaceReadFileArgs;
  readonly context: ToolContext;
}) {
  const runtime = resolveWorkspaceFileToolRuntime(input.context);
  const parsedLocator = input.args.locator ? parseFileLocator(input.args.locator) : undefined;
  if (parsedLocator && parsedLocator.kind !== 'workspace') {
    throw new Error(
      '[READ_FILE_LOCATOR_SCHEME_UNSUPPORTED] Workspace identity 必须使用 workspace: locator。'
    );
  }
  const resolved = await resolveWorkspaceVfsNode({
    db: runtime.db,
    projectId: runtime.projectId,
    conversationId: runtime.conversationId,
    instanceId: runtime.instanceId,
    includeSystemNodes: true,
    nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
    ...(input.args.inode ? { inode: input.args.inode } : { path: parsedLocator?.path }),
  });
  if (!resolved.ok) {
    throw new Error(resolved.hint ? `${resolved.message} ${resolved.hint}` : resolved.message);
  }
  return { runtime, node: resolved.node };
}

async function readWorkspaceLocator(input: {
  readonly args: WorkspaceReadFileArgs;
  readonly context: ToolContext;
}): Promise<string> {
  const { runtime, node } = await resolveWorkspaceIdentity(input);
  const locator = formatWorkspaceFileLocator(node.path);
  if (input.args.view === 'document') {
    const document = await readWorkspaceDocumentForTool(
      {
        document_id: node.id,
        max_chars: input.args.limit,
        offset_chars: input.args.offset,
        view_mode: 'preview',
        include_structure_only: false,
      },
      input.context
    );
    const sources = document.citationSources;
    const diagnostics = document.citationDiagnostics;
    if ((sources === undefined) !== (diagnostics === undefined)) {
      throw new Error(
        'Workspace document citation provider returned an incomplete citation contract.'
      );
    }
    const hasCitationFacts =
      !!sources && !!diagnostics && (sources.length > 0 || diagnostics.length > 0);
    const citationProjection = hasCitationFacts
      ? await remapWorkspaceCitationRefs({
          sources,
          diagnostics,
          allocator: requireCitationRefAllocator(input.context),
        })
      : undefined;
    const citationFields = citationProjection
      ? buildReadFileCitationFields({
          sources: citationProjection.sources,
          diagnostics: citationProjection.diagnostics,
          citationOffset:
            citationProjection.sources.length > 0
              ? requireCitationSequenceOffset(input.context)
              : 0,
        })
      : undefined;
    return JSON.stringify(
      WorkspaceReadFileResultSchema.parse({
        data: {
          source_kind: 'workspace_document',
          locator,
          inode: node.inode,
          content_type: 'application/vnd.linnya.document-view',
          document: citationProjection
            ? citationProjection.remapDocumentData(document.data)
            : document.data,
          ...(citationFields ?? {}),
        },
        observation: citationProjection
          ? citationProjection.remapText(document.observation)
          : document.observation,
        observationPreviewMeta: document.observationPreviewMeta,
      }),
      null,
      2
    );
  }

  const read = await readWorkspaceVfsNode({
    db: runtime.db,
    projectId: runtime.projectId,
    conversationId: runtime.conversationId,
    instanceId: runtime.instanceId,
    inode: node.inode,
    maxChars: input.args.offset + input.args.limit + 1,
    nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
  });
  if (!read.ok) {
    throw new Error(read.hint ? `${read.message} ${read.hint}` : read.message);
  }
  const window = sliceTextWindow(read.text, input.args.offset, input.args.limit);
  const hasMore = window.hasMore || read.truncated;
  const citationWindow = read.citationProjection
    ? buildDocumentCitationWindowOutput({
        bodyWindow: window.text,
        projection: read.citationProjection,
      })
    : undefined;
  const hasCitationFacts =
    !!citationWindow &&
    (citationWindow.citationSources.length > 0 || citationWindow.citationDiagnostics.length > 0);
  const citationProjection = hasCitationFacts
    ? await remapWorkspaceCitationRefs({
        sources: citationWindow.citationSources,
        diagnostics: citationWindow.citationDiagnostics,
        allocator: requireCitationRefAllocator(input.context),
      })
    : undefined;
  const citationFields = citationProjection
    ? buildReadFileCitationFields({
        sources: citationProjection.sources,
        diagnostics: citationProjection.diagnostics,
        citationOffset:
          citationProjection.sources.length > 0 ? requireCitationSequenceOffset(input.context) : 0,
      })
    : undefined;
  const nextOffset = input.args.offset + window.text.length;
  const data: WorkspaceReadFileResult['data'] = {
    source_kind: 'workspace_vfs',
    locator,
    inode: read.node.inode,
    content_type: read.contentType,
    node: toFileToolEntry(read.node),
    offset: input.args.offset,
    limit: input.args.limit,
    truncated: read.truncated,
    has_more: hasMore,
    ...(hasMore ? { next_offset: nextOffset } : {}),
    ...(citationFields ?? {}),
  };
  return JSON.stringify(
    WorkspaceReadFileResultSchema.parse({
      data,
      observation: formatReadFileObservation({
        locator,
        text: citationProjection ? citationProjection.remapText(window.text) : window.text,
        offset: input.args.offset,
        ...(hasMore ? { nextOffset } : {}),
        ...(citationWindow?.observationSuffix
          ? {
              supplement: citationProjection
                ? citationProjection.remapText(citationWindow.observationSuffix)
                : citationWindow.observationSuffix,
            }
          : {}),
      }),
    }),
    null,
    2
  );
}

/** 跨 VFS、conversation 与 host 的唯一 live read_file 分派点。 */
export async function readFileForTool(input: {
  readonly args: WorkspaceReadFileArgs;
  readonly rawArgs: Readonly<Record<string, unknown>>;
  readonly context: ToolContext;
}): Promise<string> {
  if (!input.args.locator || input.args.inode) {
    return readWorkspaceLocator({ args: input.args, context: input.context });
  }
  const parsedLocator = parseFileLocator(input.args.locator);
  if (parsedLocator.kind === 'workspace') {
    return readWorkspaceLocator({ args: input.args, context: input.context });
  }
  return readPhysicalLocator({
    parsedLocator,
    args: input.args,
    rawArgs: input.rawArgs,
    context: input.context,
  });
}
