import { JsonValueSchema, type DocumentReferenceMarkdownBinding } from '@app/schemas';
import { parseMarkdownDocument } from '@linnya/markdown-document-core';
import { DocumentReferenceMarkdownError, type createDocumentReferenceMarkdownRuntime } from '@plugin/backend/documentReferences';
import { resolveWorkspaceDocumentPath, readWorkspaceDocumentLocation } from '@plugin/backend/workspaceDocumentProjection';
import type { BackendPluginCliExecutionContext } from '@plugin/backend/pluginCli';
import { CanvasTextDocumentSchema, type CanvasSnapshot } from '../../shared';
import { CanvasMeasureBatchRequestSchema } from '../../shared/rendering';
import { CANVAS_DEFAULT_FONT_FAMILY, CANVAS_DEFAULT_FONT_SIZE } from '../../shared/rendering/definitions/canvasTypography';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import type { CanvasBackendCapabilities } from '../definitions/canvasBackendCapabilities';
import { normalizeCanvasInlineImages, CanvasWriteFailure, type CanvasWritePorts } from '../features/canvasWrite';
import { collectCanvasContentAssetIds } from '../features/canvasDocument';
import { listCanvasContentReferencedDocuments } from '../features/canvasProjection';
import { createCanvasImagePreparation } from './createCanvasImagePreparation';
import { readCanvasResources } from '../orchestration/readCanvasRenderingResources';

export function createCanvasWritePreparationPorts(input: { readonly database: CanvasDatabase; readonly snapshot: CanvasSnapshot; readonly context: BackendPluginCliExecutionContext;
  readonly projectId: string;
  readonly readerId: string; readonly conversationRoot: string; readonly requestId: string; readonly dryRun: boolean;
  readonly references: ReturnType<typeof createDocumentReferenceMarkdownRuntime>; readonly capabilities: CanvasBackendCapabilities }) {
  const bindings: DocumentReferenceMarkdownBinding[] = [];
  const images = createCanvasImagePreparation({ ...input, documentId: input.snapshot.documentId, signal: input.context.signal });
  let newCard = 0;
  const ports: CanvasWritePorts = {
    async parseText(markdown, baseline) {
      try {
        const canonical = input.snapshot.elements.find(element => element.id === baseline?.elementId);
        const parsed = CanvasTextDocumentSchema.parse(parseMarkdownDocument(markdown));
        const admitted = input.references.admit({ readerId: input.readerId, sourceDocumentId: input.snapshot.documentId,
          sourceKey: baseline ? `${baseline.elementId}:${baseline.revision}` : `new:${input.requestId}:${newCard++}`,
          content: JsonValueSchema.parse(parsed), existingContent: baseline?.mode === 'replace' && canonical?.type === 'text' ? JsonValueSchema.parse(canonical.data.content) : undefined });
        bindings.push(...admitted.bindings);
        return await normalizeCanvasInlineImages(CanvasTextDocumentSchema.parse(admitted.content), source => images.prepare(source, input.dryRun));
      } catch (error) {
        if (error instanceof CanvasWriteFailure) throw error;
        if (error instanceof DocumentReferenceMarkdownError) throw new CanvasWriteFailure(error.code, error.message, undefined, 'text');
        throw new CanvasWriteFailure('invalid_content', '正文不符合受支持的Markdown格式。请检查块类型、行内格式和图片来源。', undefined, 'text');
      }
    },
    async resolveDocument(path) {
      // Plugin CLI 的项目由已授权父execution冻结；hostContext只是数据能力，不是文件工具上下文。
      const resolved = resolveWorkspaceDocumentPath(input.database, { projectId: input.projectId, path });
      if (!resolved) throw new CanvasWriteFailure('document_unavailable', '文档路径不存在或不在当前项目。', undefined, 'document');
      if (resolved.nodeType === 'folder') throw new CanvasWriteFailure('document_unavailable', '文档卡不能指向目录。', undefined, 'document');
      const location = readWorkspaceDocumentLocation(input.database, resolved.id);
      if (!location) throw new CanvasWriteFailure('document_unavailable', '文档当前无法定位。', undefined, 'document');
      bindings.push({ referenceId: `document-card-input:${bindings.length}`, targetDocumentId: resolved.id, path: location.path, label: resolved.name });
      return resolved.id;
    },
    prepareImage: (file, dryRun) => images.prepare(file, dryRun),
    async measure(cards, signal) {
      const resources = await readCanvasResources({ database: input.database, documentId: input.snapshot.documentId, signal, covers: false,
        assetIds: cards.flatMap(card => collectCanvasContentAssetIds(card.content)), documentIds: cards.flatMap(card => listCanvasContentReferencedDocuments(card.content)), preparedAssets: images.readPreparedAssets() });
      return input.capabilities.measurement.measureBatch(CanvasMeasureBatchRequestSchema.parse({ protocol: 1, kind: 'measureBatch', requestId: `measure:${input.requestId}`,
        theme: 'light', dpr: 1, fontFamily: CANVAS_DEFAULT_FONT_FAMILY, fontSize: CANVAS_DEFAULT_FONT_SIZE,
        cards: cards.map(card => ({ ...card, contentVersion: 1 })), ...resources }), signal);
    },
  };
  return { ports, readBindings: (): readonly DocumentReferenceMarkdownBinding[] => bindings };
}
