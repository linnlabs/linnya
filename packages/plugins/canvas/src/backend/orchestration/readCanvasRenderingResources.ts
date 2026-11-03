import { createDocumentImageAssetRuntime } from '@plugin/backend/documentImageAsset';
import { createDocumentPreviewReader, listDocumentPreviewTypes } from '@plugin/backend/documentPreview';
import { resolveDocumentReference } from '@plugin/backend/documentReferences';
import { CANVAS_DOCUMENT_TYPE, type CanvasSnapshot } from '../../shared';
import type { CanvasRenderRequest } from '../../shared/rendering';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import { collectCanvasAssetIds, readCanvasDocumentIdentity } from '../features/canvasDocument';
import { listCanvasReferencedDocuments } from '../features/canvasProjection';
interface ResourceInput { readonly database: CanvasDatabase; readonly documentId: string; readonly signal: AbortSignal;
  readonly assetIds: readonly string[]; readonly documentIds: readonly string[]; readonly covers: boolean; readonly preparedAssets?: ReadonlyMap<string, string> }
type DocumentResource = CanvasRenderRequest['documents'][string];
function readPresentation(database: CanvasDatabase, sourceId: string, targetId: string, available: ReadonlySet<string>) {
  const resolution = resolveDocumentReference(database, { sourceDocumentId: sourceId, targetDocumentId: targetId });
  const status = resolution.status === 'available' && resolution.nodeType !== null && !available.has(resolution.nodeType) ? 'plugin_unavailable' : resolution.status;
  const metadata: DocumentResource = { title: resolution.title ?? '文档当前不可访问', status };
  return { metadata, nodeType: resolution.nodeType };
}
async function readDocumentCover(input: ResourceInput, targetId: string, available: ReadonlySet<string>, previews: ReturnType<typeof createDocumentPreviewReader>): Promise<DocumentResource> {
  const source = readCanvasDocumentIdentity(input.database, input.documentId);
  const { metadata, nodeType } = readPresentation(input.database, source.id, targetId, available);
  // 内层Canvas永远是身份牌，避免互引递归；其他内容owner决定自己的静态预览。
  if (!input.covers || metadata.status !== 'available' || nodeType === CANVAS_DOCUMENT_TYPE || source.projectId === null) return metadata;
  const preview = await previews.read({ documentId: targetId, projectId: source.projectId, widthPx: 640, pixelRatio: 1 });
  return preview.status === 'ready' && preview.content?.image ? { ...metadata, image: preview.content.image.dataUri, keepThumbnail: preview.content.overview === 'thumbnail' } : metadata;
}
function refreshResourceTitles(database: CanvasDatabase, documentId: string, documents: CanvasRenderRequest['documents'], available: ReadonlySet<string>) {
  // 最后一项封面可能等待数百毫秒；投递前同步重验全部标题，防止期间移出项目。
  for (const targetId of Object.keys(documents)) {
    const { metadata } = readPresentation(database, documentId, targetId, available), previous = documents[targetId];
    documents[targetId] = { ...metadata, ...(metadata.status === 'available' && previous.status === 'available' ? { image: previous.image, keepThumbnail: previous.keepThumbnail } : {}) };
  }
}
export async function readCanvasResources(input: ResourceInput) {
  readCanvasDocumentIdentity(input.database, input.documentId);
  const assets: CanvasRenderRequest['assets'] = {}, documents: CanvasRenderRequest['documents'] = {};
  const images = createDocumentImageAssetRuntime(input.database);
  for (const assetId of new Set(input.assetIds)) {
    input.signal.throwIfAborted();
    const prepared = input.preparedAssets?.get(assetId);
    assets[assetId] = prepared === undefined ? (await images.readOwnedImage({ documentId: input.documentId, assetId })).dataUri : prepared;
  }
  const previews = createDocumentPreviewReader(input.database);
  const available = new Set(listDocumentPreviewTypes().filter(type => type.enabled).map(type => type.nodeType));
  for (const targetId of new Set(input.documentIds)) {
    input.signal.throwIfAborted(); documents[targetId] = await readDocumentCover(input, targetId, available, previews);
  }
  input.signal.throwIfAborted(); refreshResourceTitles(input.database, input.documentId, documents, available);
  return { assets, documents };
}
export function readCanvasRenderingResources(input: { readonly database: CanvasDatabase; readonly snapshot: CanvasSnapshot; readonly signal: AbortSignal; readonly covers: boolean }) {
  return readCanvasResources({ ...input, documentId: input.snapshot.documentId, assetIds: collectCanvasAssetIds(input.snapshot.elements), documentIds: listCanvasReferencedDocuments(input.snapshot.elements) });
}
