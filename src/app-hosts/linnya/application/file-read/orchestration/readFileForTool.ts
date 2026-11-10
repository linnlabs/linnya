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
import {
  buildTextLineWindow,
  formatTextLineWindow,
} from 'src/tools/workspace/read_file/functions/buildTextLineWindow';
import { readWorkspaceDocumentForTool } from 'src/tools/workspace/read_file/workspaceDocumentReadAdapter';
import { resolveWorkspaceFileToolRuntime } from 'src/tools/workspace/shared/fileToolContext';
import { toFileToolEntry } from 'src/tools/workspace/shared/fileToolOutput';
import { countTextCharacters } from 'src/shared/textCharacterMetrics';
import { prependReadTextMetrics } from 'src/tools/workspace/shared/textMetricsObservation';
import type { ToolContext } from 'src/tools/types';
import { PhysicalFileReadError } from '../definitions/physicalFileRead';
import { hasRunImageAttachment } from '../functions/hasRunImageAttachment';
import { remapWorkspaceCitationRefs } from '../functions/remapWorkspaceCitationRefs';
import { readDocumentPropertySection } from '../../document-properties';
import { registerDeliveredDocumentReferences, stripDocumentReferenceReadMetadata } from './registerDeliveredDocumentReferences';
import { readPhysicalFileForTool } from './readPhysicalFileForTool';

const IMAGE_READ_OBSERVATIONS = {
  attached: '已读取图片文件；真实像素已附加到本次工具结果。',
  already_attached: '已读取图片文件；相同像素已在当前 run 的模型上下文中，本次未重复附加。',
  not_delivered:
    '已读取图片文件的格式和尺寸；当前模型连接不接收工具结果图片，你没有看到像素。不要声称已看过这张图，需要像素判断时在答复中说明未检查。',
} as const;

type TextReadFileArgs = Extract<WorkspaceReadFileArgs, { readonly view: 'text' }>;

// VFS provider 当前先产出完整字符串，再在边界裁剪。行号分页必须先看到真实换行；
// 这里把 source admission 与模型 observation 预算分开，避免再次把字符 cursor 暴露给 Agent。
const WORKSPACE_READ_FILE_SOURCE_MAX_CHARS = 20 * 1024 * 1024;

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
  readonly args: TextReadFileArgs;
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
  // ToolNode 只在真实 active model 不收工具结果图片时才明确拒绝；无 ToolNode 的直接调用仍按附加处理。
  const imageDelivery =
    input.context.modelInputAdmission?.admitted === false ? 'metadata_only' : 'attach';
  const hasExplicitTextWindow = ['offset', 'limit', 'offset_chars', 'max_chars'].some(key =>
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
          imageDelivery,
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
      imageDelivery,
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
        observation: IMAGE_READ_OBSERVATIONS[read.attachmentStatus],
        ...(attached ? { modelInput: { attachments: [read.selection] } } : {}),
      }),
      null,
      2
    );
  }

  const window = buildTextLineWindow({
    text: read.text,
    offset: input.args.offset,
    limit: input.args.limit,
  });
  const textMetrics = {
    window: countTextCharacters(window.rawText),
    full_text: countTextCharacters(read.text),
  };
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
        line_count: window.lineCount,
        total_line_count: window.totalLineCount,
        text_metrics: textMetrics,
        has_more: window.hasMore,
        ...(window.nextOffset !== undefined ? { next_offset: window.nextOffset } : {}),
      },
      observation: prependReadTextMetrics(formatTextLineWindow({
        locator: read.locator,
        window,
      }), textMetrics),
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

/** 属性段只放在第一页之前：续读下一页时不重复。 */
function withPropertySection(
  context: ToolContext, projectId: string, documentId: string, firstWindow: boolean, observation: string,
): string {
  const db = context.databaseService?.getDb();
  const section = firstWindow && db ? readDocumentPropertySection(db, projectId, documentId) : null;
  return section ? `${section}\n\n${observation}` : observation;
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
        max_chars: input.args.max_chars,
        offset_chars: input.args.offset_chars,
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
    const observation = citationProjection
      ? citationProjection.remapText(document.observation)
      : document.observation;
    registerDeliveredDocumentReferences({ context: input.context, documentId: node.id, metadata: document.data.details?.documentReferences, text: document.data.presentation.kind === 'blocks' ? document.data.presentation.items.map(item => item.text).join('\n\n') : document.data.presentation.kind === 'text' ? document.data.presentation.text : '' });
    const visibleDocument = stripDocumentReferenceReadMetadata(document.data);
    // DocumentView 的 nextOffset 属于源文档；工具 facade 才负责说明下一次工具调用。
    const nextPage =
      document.data.nextOffset === null
        ? ''
        : `\n\n[read_file: 读完本次返回后，文档下一页：read_file(${JSON.stringify({
            locator,
            view: 'document',
            offset_chars: document.data.nextOffset,
            max_chars: input.args.max_chars,
          })})]`;
    return JSON.stringify(
      WorkspaceReadFileResultSchema.parse({
        data: {
          source_kind: 'workspace_document',
          locator,
          inode: node.inode,
          content_type: 'application/vnd.linnya.document-view',
          document: citationProjection
            ? citationProjection.remapDocumentData(visibleDocument)
            : visibleDocument,
          ...(citationFields ?? {}),
        },
        observation: withPropertySection(
          input.context, runtime.projectId, node.id, (input.args.offset_chars ?? 0) === 0, observation + nextPage,
        ),
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
    maxChars: WORKSPACE_READ_FILE_SOURCE_MAX_CHARS,
    nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
  });
  if (!read.ok) {
    throw new Error(read.hint ? `${read.message} ${read.hint}` : read.message);
  }
  if (read.truncated) {
    throw new Error(
      `[READ_FILE_SOURCE_TOO_LARGE] ${locator} 超过 ${WORKSPACE_READ_FILE_SOURCE_MAX_CHARS} 字符，无法建立可信行号窗口。`,
    );
  }
  const window = buildTextLineWindow({
    text: read.text,
    offset: input.args.offset,
    limit: input.args.limit,
  });
  const citationWindow = read.citationProjection
    ? buildDocumentCitationWindowOutput({
        bodyWindow: window.rawText,
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
  const returnedText = citationProjection
    ? citationProjection.remapText(window.rawText)
    : window.rawText;
  registerDeliveredDocumentReferences({ context: input.context, documentId: node.id, metadata: read.metadata?.documentReferences, text: returnedText });
  const textMetrics = {
    window: countTextCharacters(returnedText),
    full_text: countTextCharacters(read.text),
  };
  const data: WorkspaceReadFileResult['data'] = {
    source_kind: 'workspace_vfs',
    locator,
    inode: read.node.inode,
    content_type: read.contentType,
    node: toFileToolEntry(read.node),
    offset: input.args.offset,
    limit: input.args.limit,
    line_count: window.lineCount,
    total_line_count: window.totalLineCount,
    text_metrics: textMetrics,
    has_more: window.hasMore,
    ...(window.nextOffset !== undefined ? { next_offset: window.nextOffset } : {}),
    ...(citationFields ?? {}),
  };
  return JSON.stringify(
    WorkspaceReadFileResultSchema.parse({
      data,
      observation: prependReadTextMetrics(withPropertySection(
        input.context, runtime.projectId, node.id, (input.args.offset ?? 1) === 1,
        formatTextLineWindow({
          locator,
          window,
          text: returnedText,
          ...(citationWindow?.observationSuffix
            ? {
                supplement: citationProjection
                  ? citationProjection.remapText(citationWindow.observationSuffix)
                  : citationWindow.observationSuffix,
              }
            : {}),
        }),
      ), textMetrics),
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
  if (input.args.view !== 'text') {
    throw new Error('[READ_FILE_DOCUMENT_VIEW_REQUIRES_WORKSPACE] DocumentView 只支持 Workspace 文件。');
  }
  return readPhysicalLocator({
    parsedLocator,
    args: input.args,
    rawArgs: input.rawArgs,
    context: input.context,
  });
}
