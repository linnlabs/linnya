import { sliceTextWindow } from '@app/schemas/document-view';
import type {
  DocumentTypeBackendCreateResult,
  DocumentTypeDiagnostic,
  DocumentTypeBackendDuplicateResult,
  DocumentTypeBackendHook,
  DocumentTypeBackendReadResult,
  DocumentTypeBackendToolReadData,
  DocumentTypeBackendToolReadResult,
  DocumentTypeBackendWriteResult,
} from '@plugin/backend/documentTypeBackendHook';
import type { CodegenDiagnostic } from '@plugin/slides/backend-codegen';
import type { PresentationWriteFailure } from '@plugin/slides/backend-codegen';
import {
  SLIDES_DOCUMENT_TYPE,
  SLIDES_FILE_EXTENSION,
  SLIDES_FILE_EXTENSIONS,
} from '@plugin/slides/shared';

import type {
  SlidesDocumentHookReadOutput,
  SlidesDocumentHookRuntimeFactory,
} from './presentationDocumentHookRuntime';
import { readPresentationVfsContent } from './infrastructure/readPresentationVfsContent';

interface SlidesProjectCharCountRow {
  readonly total: number;
}

function readRequiredConversationId(context: unknown): string {
  const conversationId =
    typeof context === 'object' && context !== null
      ? Reflect.get(context, 'conversationId')
      : undefined;
  if (typeof conversationId !== 'string' || conversationId.trim().length === 0) {
    throw new Error('No conversation context available.');
  }
  return conversationId.trim();
}

function readString(data: Record<string, unknown> | undefined, key: string): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function mapCodegenDiagnostics(
  diagnostics: readonly CodegenDiagnostic[]
): DocumentTypeDiagnostic[] {
  return diagnostics.map(diagnostic => ({
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.hint
      ? `${diagnostic.message} 建议：${diagnostic.hint}`
      : diagnostic.message,
    ...(diagnostic.phase === 'structure'
      ? { target: formatSourceTarget(diagnostic) }
      : diagnostic.path.length > 0
        ? { target: diagnostic.path }
        : {}),
  }));
}

function mapBuildFailureDiagnostics(
  failure: PresentationWriteFailure | undefined
): DocumentTypeDiagnostic[] {
  if (!failure) return [];
  const message = `${failure.summary} 下一步：${failure.nextAction}`;
  if (!failure.diagnostics || failure.diagnostics.length === 0) {
    return [{ severity: 'error', code: failure.code, message }];
  }
  return failure.diagnostics.map(diagnostic => ({
    severity: 'error',
    code: failure.code,
    message,
    target: `line ${diagnostic.line}, column ${diagnostic.column} (TS${diagnostic.tsCode})`,
  }));
}

function mapWriteDiagnostics(result: {
  readonly diagnostics: readonly CodegenDiagnostic[];
  readonly buildFailure?: PresentationWriteFailure;
}): DocumentTypeDiagnostic[] {
  return [
    ...mapBuildFailureDiagnostics(result.buildFailure),
    ...mapCodegenDiagnostics(result.diagnostics),
  ];
}

function formatSourceTarget(
  diagnostic: Extract<CodegenDiagnostic, { phase: 'structure' }>
): string {
  const { startLine, endLine } = diagnostic.sourceSpan;
  const lineTarget = startLine === endLine ? `line ${startLine}` : `line ${startLine}-${endLine}`;
  return diagnostic.slideNumber ? `${lineTarget}, slide ${diagnostic.slideNumber}` : lineTarget;
}

function buildSlidesToolDocumentView(
  read: SlidesDocumentHookReadOutput,
  documentName: string,
  offsetChars: number,
  maxChars: number
): {
  readonly observation: string;
  readonly data: DocumentTypeBackendToolReadData;
} {
  const rawContent = read.file.content ?? '';
  const windowResult = sliceTextWindow(rawContent, offsetChars, maxChars, true);

  return {
    observation: windowResult.text,
    data: {
      documentId: read.file.presentationId,
      docType: SLIDES_DOCUMENT_TYPE,
      truncatedByChars: windowResult.truncated,
      totalTextLength: windowResult.totalLength,
      nextOffset: windowResult.nextOffset,
      documentName,
      presentation: { kind: 'text', text: windowResult.text },
      details: {
        presentationId: read.file.presentationId,
        title: read.file.title,
        versionId: read.file.versionId,
        sourceOrigin: read.file.sourceOrigin,
        sourceKey: read.file.sourceKey,
        totalLines: read.file.totalLines,
        startLine: read.file.startLine,
        numLines: read.file.numLines,
        ...(typeof read.file.slide === 'number' ? { slide: read.file.slide } : {}),
        ...(read.file.draftStatus ? { draftStatus: read.file.draftStatus } : {}),
      },
    },
  };
}

function formatCreateObservation(params: {
  readonly path: string;
  readonly inode: string;
  readonly result: DocumentTypeBackendCreateResult;
}): string {
  const presentationId =
    readString(params.result.toolResultData, 'presentationId') ?? params.result.documentId;
  const versionId = readString(params.result.toolResultData, 'versionId');
  const buildStatus = readString(params.result.toolResultData, 'buildStatus');
  return (
    [
      `已创建 Slides 文件：${params.path}。presentation_id: ${presentationId}`,
      `inode: ${params.inode}`,
      ...(versionId ? [`version_id: ${versionId}`] : []),
      ...(buildStatus === 'draft'
        ? ['源码已保存，但 PPT 编译失败；当前不可预览，请根据下方错误修复源码']
        : []),
    ].join('；') + '。'
  );
}

function formatWriteObservation(params: {
  readonly path: string;
  readonly inode: string;
  readonly result: DocumentTypeBackendWriteResult;
  readonly operation: 'write' | 'edit';
}): string {
  const buildStatus = readString(params.result.toolResultData, 'buildStatus');
  if (params.operation === 'edit') {
    return buildStatus === 'draft'
      ? `已更新 Slides 文件：${params.path}；源码已保存，但 PPT 编译失败；当前不可预览，请根据下方错误修复源码。`
      : `已更新 Slides 文件：${params.path}`;
  }
  const presentationId = readString(params.result.toolResultData, 'presentationId');
  const versionId = readString(params.result.toolResultData, 'versionId');
  return (
    [
      `已写入 Slides 文件：${params.path}`,
      ...(presentationId ? [`presentation_id: ${presentationId}`] : []),
      `inode: ${params.inode}`,
      ...(versionId ? [`version_id: ${versionId}`] : []),
      ...(buildStatus === 'draft'
        ? ['源码已保存，但 PPT 编译失败；当前不可预览，请根据下方错误修复源码']
        : []),
    ].join('；') + '。'
  );
}

export function createPresentationDocumentTypeBackendHook(
  createRuntime: SlidesDocumentHookRuntimeFactory
): DocumentTypeBackendHook {
  return {
    docType: SLIDES_DOCUMENT_TYPE,
    displayName: '演示文稿',
    fileExtension: SLIDES_FILE_EXTENSION,
    fileExtensions: SLIDES_FILE_EXTENSIONS,
    systemViews: [
      { name: 'source.js', viewKind: 'presentation_source' },
      { name: 'structure.md', viewKind: 'presentation_structure' },
    ],
    formatCreateObservation,
    formatWriteObservation,
    async createDocument(params) {
      const runtime = createRuntime(params.context);
      if (params.content === undefined) {
        const result = await runtime.createEmptyPresentation({
          projectId: params.projectId,
          ...(params.parentId ? { parentId: params.parentId } : {}),
          title: params.name,
        });
        return {
          documentId: result.nodeId,
          toolResultData: {
            presentationId: result.nodeId,
            versionId: result.versionId,
          },
        };
      }

      const result = await runtime.writeSource(
        {
          source: params.content,
        },
        {
          conversationId: readRequiredConversationId(params.context),
          projectId: params.projectId,
          ...(params.parentId ? { parentId: params.parentId } : {}),
          requestedTitle: params.name,
        }
      );
      runtime.renameCreatedNodeToRequestedFileName({
        nodeId: result.presentationId,
        fileName: params.name,
      });
      return {
        documentId: result.presentationId,
        toolResultData: {
          presentationId: result.presentationId,
          versionId: result.versionId,
          versionNumber: result.versionNumber,
          buildStatus: result.buildStatus,
          ...(result.draftStatus ? { draftStatus: result.draftStatus } : {}),
          ...(result.buildFailure ? { buildFailure: result.buildFailure } : {}),
        },
        diagnostics: mapWriteDiagnostics(result),
      };
    },
    async writeDocument(params) {
      const runtime = createRuntime(params.context);
      const conversationId = readRequiredConversationId(params.context);
      const result = await runtime.writeSource(
        {
          presentationId: params.documentId,
          source: params.content,
          ...(params.expectedSourceKey ? { expectedSourceKey: params.expectedSourceKey } : {}),
        },
        {
          conversationId,
          projectId: params.projectId,
        }
      );
      return {
        toolResultData: {
          presentationId: result.presentationId,
          versionId: result.versionId,
          versionNumber: result.versionNumber,
          buildStatus: result.buildStatus,
          ...(result.draftStatus ? { draftStatus: result.draftStatus } : {}),
          ...(result.buildFailure ? { buildFailure: result.buildFailure } : {}),
        },
        diagnostics: mapWriteDiagnostics(result),
      };
    },
    async duplicateDocument(params): Promise<DocumentTypeBackendDuplicateResult | null> {
      const runtime = createRuntime(params.context);
      const conversationId = readRequiredConversationId(params.context);
      const read = await runtime.readSource({
        presentationId: params.sourceDocumentId,
        conversationId,
      });
      if (read.type !== 'text' || typeof read.file.content !== 'string') {
        return null;
      }
      const result = await runtime.writeSource(
        {
          source: read.file.content,
        },
        {
          conversationId,
          projectId: params.projectId,
          ...(params.parentId ? { parentId: params.parentId } : {}),
          requestedTitle: params.name,
        }
      );
      runtime.renameCreatedNodeToRequestedFileName({
        nodeId: result.presentationId,
        fileName: params.name,
      });
      return { documentId: result.presentationId };
    },
    async readDocument(params): Promise<DocumentTypeBackendToolReadResult | null> {
      const runtime = createRuntime(params.context);
      const read = await runtime.readSource({
        presentationId: params.documentId,
        conversationId: readRequiredConversationId(params.context),
      });
      if (read.type === 'deck_unchanged') {
        const observation = `Slides 文件未变化：${params.documentName}`;
        return {
          observation,
          data: {
            documentId: read.file.presentationId,
            docType: SLIDES_DOCUMENT_TYPE,
            truncatedByChars: false,
            totalTextLength: observation.length,
            nextOffset: null,
            documentName: params.documentName,
            presentation: { kind: 'text', text: observation },
            details: {
              presentationId: read.file.presentationId,
              title: read.file.title,
            },
          },
        };
      }
      return buildSlidesToolDocumentView(
        read,
        params.documentName,
        params.offsetChars,
        params.maxChars
      );
    },
    readVfsContent(params): DocumentTypeBackendReadResult | null {
      return readPresentationVfsContent(params);
    },
    readProjectCharCount(params): number {
      const row = params.db
        .prepare(
          `
        SELECT COALESCE(SUM(LENGTH(p.deck_source)), 0) AS total
        FROM presentation_documents p
        INNER JOIN workspace_nodes wn
          ON wn.id = p.node_id
        WHERE
          wn.project_id = ?
          AND wn.deleted_at IS NULL
          AND wn.type = ?
      `
        )
        .get(params.projectId, SLIDES_DOCUMENT_TYPE);
      if (row === undefined) return 0;
      if (!isSlidesProjectCharCountRow(row)) {
        throw new Error(`Slides 项目字符统计结构异常：${params.projectId}`);
      }
      return row.total;
    },
  };
}

function isSlidesProjectCharCountRow(value: unknown): value is SlidesProjectCharCountRow {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'total') === 'number'
  );
}
