import { JsonValueSchema, type DocumentReferenceMarkdownBinding } from '@app/schemas';
import { parseMarkdownDocument } from '@linnya/markdown-document-core';
import { DocumentReferenceMarkdownError, type createDocumentReferenceMarkdownRuntime } from '@plugin/backend/documentReferences';
import { resolveWorkspaceVfsNodeForPluginTool } from '@plugin/backend/workspaceRuntime';
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
      const resolved = await resolveWorkspaceVfsNodeForPluginTool(input.context.hostContext, { path });
      if (!resolved.ok || resolved.node.type === 'folder') throw new CanvasWriteFailure('document_unavailable', resolved.ok ? '文档卡不能指向目录。' : resolved.message, undefined, 'document');
      bindings.push({ referenceId: `document-card-input:${bindings.length}`, targetDocumentId: resolved.node.id, path: `workspace:${resolved.node.path}`, label: resolved.node.name });
      return resolved.node.id;
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
