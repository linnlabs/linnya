import { sliceTextWindow, type WorkspaceDocumentReadData } from '@app/schemas';
import type { MarkdownReadDatabase } from '../../../definitions/markdownReadDatabase';
import { MarkdownImageBlockReader } from '../../block-content';
import type {
  MarkdownDocumentNormalizer,
  MarkdownDocumentReadProjection,
  MarkdownDocumentReadRequest,
  MarkdownDocumentReadStore,
} from '../definitions/markdownDocumentRead';
import { buildMarkdownDocumentImagesObservation } from '../functions/markdownDocumentImages';
import { buildMarkdownDocumentView } from '../functions/markdownDocumentView';
import { buildMarkdownOutline } from '../functions/markdownOutline';
import { buildMarkdownPendingDiffs } from '../functions/markdownPendingDiffs';
import { buildMarkdownReadPresentation } from '../functions/markdownReadPresentation';
import { buildMarkdownCitationReadProjection } from './buildMarkdownCitationReadProjection';

export async function readMarkdownDocumentView(params: {
  readonly request: MarkdownDocumentReadRequest;
  readonly readDb: MarkdownReadDatabase;
  readonly store: MarkdownDocumentReadStore;
  readonly normalizer: MarkdownDocumentNormalizer;
}): Promise<MarkdownDocumentReadProjection> {
  const normalization = await params.normalizer.normalizeDocumentIfNeeded(
    params.request.documentId,
  );
  if (normalization.status === 'failed') {
    throw new Error(
      `Markdown 文档后端规范化失败，无法安全读取块结构：${normalization.reason ?? '未知原因'}`,
    );
  }

  const content = params.store.getDocument(params.request.documentId);
  const images = new MarkdownImageBlockReader(params.readDb)
    .listForDocument(params.request.documentId);
  const imagesObservation = buildMarkdownDocumentImagesObservation(images);
  const imageData = images.length > 0 ? { images } : {};

  if (params.request.structureOnly) {
    const window = sliceTextWindow(
      buildMarkdownOutline(content),
      params.request.offsetChars,
      params.request.maxChars,
      true,
    );
    return {
      data: {
        documentId: params.request.documentId,
        docType: 'markdown',
        documentName: params.request.documentName,
        truncatedByChars: window.truncated,
        totalTextLength: window.totalLength,
        nextOffset: window.nextOffset,
        presentation: { kind: 'text', text: window.text },
        ...imageData,
      },
      primaryObservation: window.text,
      trailingObservations: imagesObservation ? [imagesObservation] : [],
    };
  }

  const pendings = params.store.getPendingRevisions(params.request.documentId);
  const citationRead = buildMarkdownCitationReadProjection({
    content,
    pendings,
    viewMode: params.request.viewMode === 'preview' ? 'preview' : 'original',
  });
  const pendingDiffs = buildMarkdownPendingDiffs({
    baseBlocks: [...citationRead.baseBlocks],
    pendings,
  });
  const viewBlocks = [...citationRead.viewBlocks];
  const view = buildMarkdownDocumentView(content, {
    documentId: params.request.documentId,
    offsetChars: params.request.offsetChars,
    maxChars: params.request.maxChars,
    preFlattenedBlocks: viewBlocks,
  });
  const data: WorkspaceDocumentReadData = {
    documentId: params.request.documentId,
    docType: 'markdown',
    documentName: params.request.documentName,
    truncatedByChars: view.truncatedByChars,
    totalTextLength: view.totalTextLength,
    nextOffset: view.nextOffset,
    presentation: buildMarkdownReadPresentation({
      documentViewText: view.documentViewText,
      blocks: viewBlocks,
      viewMode: params.request.viewMode,
      viewLabel: params.request.viewMode === 'preview' ? '修订稿' : '原文',
    }),
    ...(pendingDiffs.length > 0 ? { details: { pendingDiffs } } : {}),
    ...imageData,
  };
  return {
    data,
    primaryObservation: view.documentViewText,
    trailingObservations: imagesObservation ? [imagesObservation] : [],
    citationWindow: {
      bodyWindow: view.bodyWindowText,
      projection: citationRead.citationProjection,
    },
  };
}
