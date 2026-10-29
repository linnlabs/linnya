import { sliceTextWindow, type WorkspaceDocumentReadData } from '@app/schemas';
import type { MarkdownReadDatabase } from '../../../definitions/markdownReadDatabase';
import { projectMarkdownDocumentImages } from '../functions/projectMarkdownDocumentImages';
import type {
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
}): Promise<MarkdownDocumentReadProjection> {
  // 正文只经严格 schema 读取一次；不合法的旧格式在这里直接拒绝，不做读取前转换。
  const content = params.store.getDocument(params.request.documentId);
  const pendings = params.store.getPendingRevisions(params.request.documentId);
  const images = projectMarkdownDocumentImages(content, params.request.viewMode === 'preview' ? pendings : []);
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
      window: view.presentationWindow,
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
