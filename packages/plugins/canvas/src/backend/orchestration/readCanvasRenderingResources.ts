import { createDocumentImageAssetRuntime } from '@plugin/backend/documentImageAsset';
import { createDocumentPreviewReader, listDocumentPreviewTypes } from '@plugin/backend/documentPreview';
import { resolveDocumentReference } from '@plugin/backend/documentReferences';
import { CANVAS_DOCUMENT_TYPE, type CanvasSnapshot } from '../../shared';
import type { CanvasRenderRequest } from '../../shared/rendering';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import { collectCanvasAssetIds, readCanvasDocumentIdentity } from '../features/canvasDocument';
import { listCanvasReferencedDocuments } from '../features/canvasProjection';

export async function readCanvasResources(input: { readonly database: CanvasDatabase; readonly documentId: string; readonly signal: AbortSignal;
  readonly assetIds: readonly string[]; readonly documentIds: readonly string[]; readonly covers: boolean; readonly preparedAssets?: ReadonlyMap<string, string> }) {
  const source = readCanvasDocumentIdentity(input.database, input.documentId);
  const assets: CanvasRenderRequest['assets'] = {}, documents: CanvasRenderRequest['documents'] = {};
  const images = createDocumentImageAssetRuntime(input.database);
  for (const assetId of new Set(input.assetIds)) {
    input.signal.throwIfAborted();
    const prepared = input.preparedAssets?.get(assetId);
    assets[assetId] = prepared === undefined ? (await images.readOwnedImage({ documentId: source.id, assetId })).dataUri : prepared;
  }
  const available = new Set(listDocumentPreviewTypes().filter(type => type.enabled).map(type => type.nodeType));
  const previews = createDocumentPreviewReader(input.database);
  for (const targetDocumentId of new Set(input.documentIds)) {
    input.signal.throwIfAborted();
    const resolution = resolveDocumentReference(input.database, { sourceDocumentId: source.id, targetDocumentId });
    const status = resolution.status === 'available' && resolution.nodeType !== null && !available.has(resolution.nodeType) ? 'plugin_unavailable' : resolution.status;
    const metadata: CanvasRenderRequest['documents'][string] = { title: resolution.title ?? '文档当前不可访问', status };
    documents[targetDocumentId] = metadata;
    // 画布封面只在外层请求绘制，内部画布卡始终是身份牌，避免互引递归。
    if (!input.covers || status !== 'available' || resolution.nodeType === CANVAS_DOCUMENT_TYPE || source.projectId === null) continue;
    const preview = await previews.read({ documentId: targetDocumentId, projectId: source.projectId, widthPx: 640, pixelRatio: 1 });
    if (preview.status === 'ready' && preview.content?.image) documents[targetDocumentId] = { ...metadata, image: preview.content.image.dataUri, keepThumbnail: preview.content.overview === 'thumbnail' };
  }
  input.signal.throwIfAborted();
  // 最后一项封面可能等待数百毫秒；投递前同步重验全部标题，不能泄漏期间移出项目的身份。
  for (const targetDocumentId of Object.keys(documents)) {
    const current = resolveDocumentReference(input.database, { sourceDocumentId: source.id, targetDocumentId });
    const previous = documents[targetDocumentId];
    const status = current.status === 'available' && current.nodeType !== null && !available.has(current.nodeType) ? 'plugin_unavailable' : current.status;
    documents[targetDocumentId] = { title: current.title ?? '文档当前不可访问', status,
      ...(status === 'available' && previous.status === 'available' ? { image: previous.image, keepThumbnail: previous.keepThumbnail } : {}) };
  }
  return { assets, documents };
}

export function readCanvasRenderingResources(input: { readonly database: CanvasDatabase; readonly snapshot: CanvasSnapshot; readonly signal: AbortSignal; readonly covers: boolean }) {
  return readCanvasResources({ ...input, documentId: input.snapshot.documentId, assetIds: collectCanvasAssetIds(input.snapshot.elements), documentIds: listCanvasReferencedDocuments(input.snapshot.elements) });
}
