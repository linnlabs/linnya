import { createDocumentImageAssetRuntime } from '@plugin/backend/documentImageAsset';
import {
  createDocumentPreviewReader,
  listDocumentPreviewTypes,
} from '@plugin/backend/documentPreview';
import { resolveDocumentReference } from '@plugin/backend/documentReferences';
import { documentPreviewImageSourceKey } from '@app/schemas';
import { CANVAS_DOCUMENT_TYPE, type CanvasSnapshot } from '../../shared';
import type { CanvasRenderRequest } from '../../shared/rendering';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import {
  collectCanvasAssetIds,
  readCanvasDocumentIdentity,
  readCanvasTagNames,
} from '../features/canvasDocument';
import { listCanvasReferencedDocuments } from '../features/canvasProjection';
interface ResourceInput {
  readonly database: CanvasDatabase;
  readonly documentId: string;
  readonly signal: AbortSignal;
  readonly assetIds: readonly string[];
  readonly documentIds: readonly string[];
  readonly covers: boolean;
  readonly preparedAssets?: ReadonlyMap<string, string>;
}
type DocumentResource = CanvasRenderRequest['documents'][string];
function readPresentation(
  database: CanvasDatabase,
  sourceId: string,
  targetId: string,
  available: ReadonlySet<string>
) {
  const resolution = resolveDocumentReference(database, {
    sourceDocumentId: sourceId,
    targetDocumentId: targetId,
  });
  const status =
    resolution.status === 'available' &&
    resolution.nodeType !== null &&
    !available.has(resolution.nodeType)
      ? 'plugin_unavailable'
      : resolution.status;
  const metadata: DocumentResource = { title: resolution.title ?? '文档当前不可访问', status };
  return { metadata, nodeType: resolution.nodeType };
}
/**
 * 出图 worker 不能访问 Host，文档卡正文里的图片随请求内联。
 * 出图只排卡面首屏，但哪些图片落在首屏要排版后才知道，所以把清单里的图片都带上。
 * 取最大一档：导出倍率由请求方决定，这里不知道，清晰度不能比改为清单前差。
 */
async function readDocumentBodyImages(
  previews: ReturnType<typeof createDocumentPreviewReader>,
  target: { readonly documentId: string; readonly projectId: string },
  detail: DocumentResource['body'],
  signal: AbortSignal
): Promise<Record<string, string>> {
  const bodyImages: Record<string, string> = {};
  if (detail?.format !== 'workspace-markdown') return bodyImages;
  for (const listed of Object.values(detail.images)) {
    signal.throwIfAborted();
    const image = await previews.readImage({ ...target, source: listed.source, maxEdgePx: 2048 });
    if (!image) throw new Error('Canvas document card image is no longer readable');
    bodyImages[documentPreviewImageSourceKey(listed.source)] =
      `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString('base64')}`;
  }
  return bodyImages;
}
async function readDocumentCover(
  input: ResourceInput,
  targetId: string,
  available: ReadonlySet<string>,
  previews: ReturnType<typeof createDocumentPreviewReader>
): Promise<DocumentResource> {
  const source = readCanvasDocumentIdentity(input.database, input.documentId);
  const { metadata, nodeType } = readPresentation(input.database, source.id, targetId, available);
  const identity = {
    ...metadata,
    previewStatus:
      metadata.status === 'available' ? ('preview_unavailable' as const) : metadata.status,
  };
  // 内层Canvas永远是身份牌，避免互引递归；其他内容owner决定自己的静态预览。
  if (
    !input.covers ||
    metadata.status === 'deleted' ||
    metadata.status === 'outside_project' ||
    nodeType === CANVAS_DOCUMENT_TYPE ||
    source.projectId === null
  )
    return identity;
  const preview = await previews.read({
    documentId: targetId,
    projectId: source.projectId,
    widthPx: 640,
    pixelRatio: 1,
  });
  const detail = preview.status === 'ready' ? preview.content?.detail : undefined;
  const bodyImages = await readDocumentBodyImages(
    previews,
    { documentId: targetId, projectId: source.projectId },
    detail,
    input.signal
  );
  return {
    ...metadata,
    previewStatus: preview.status,
    ...((preview.status === 'ready' || preview.status === 'plugin_unavailable') && preview.content
      ? { summary: preview.content.summary }
      : {}),
    ...(preview.status === 'ready' && preview.content?.image
      ? {
          image: preview.content.image.dataUri,
          keepThumbnail: preview.content.overview === 'thumbnail',
        }
      : {}),
    ...(detail
      ? { body: detail, ...(Object.keys(bodyImages).length > 0 ? { bodyImages } : {}) }
      : {}),
  };
}
function refreshResourceTitles(
  database: CanvasDatabase,
  documentId: string,
  documents: CanvasRenderRequest['documents'],
  available: ReadonlySet<string>
) {
  // 最后一项封面可能等待数百毫秒；投递前同步重验全部标题，防止期间移出项目。
  for (const targetId of Object.keys(documents)) {
    const { metadata } = readPresentation(database, documentId, targetId, available),
      previous = documents[targetId];
    const ready =
      metadata.status === 'available' &&
      previous.status === 'available' &&
      previous.previewStatus === 'ready';
    const snapshot =
      metadata.status === 'plugin_unavailable' && previous.previewStatus === 'plugin_unavailable';
    documents[targetId] = {
      ...metadata,
      previewStatus: ready
        ? 'ready'
        : metadata.status === 'available'
          ? 'preview_unavailable'
          : metadata.status,
      ...(ready
        ? {
            image: previous.image,
            keepThumbnail: previous.keepThumbnail,
            summary: previous.summary,
            body: previous.body,
            bodyImages: previous.bodyImages,
          }
        : snapshot
          ? { summary: previous.summary }
          : {}),
    };
  }
}
export async function readCanvasResources(input: ResourceInput) {
  readCanvasDocumentIdentity(input.database, input.documentId);
  const assets: CanvasRenderRequest['assets'] = {},
    documents: CanvasRenderRequest['documents'] = {};
  const images = createDocumentImageAssetRuntime(input.database);
  for (const assetId of new Set(input.assetIds)) {
    input.signal.throwIfAborted();
    const prepared = input.preparedAssets?.get(assetId);
    assets[assetId] =
      prepared === undefined
        ? (await images.readOwnedImage({ documentId: input.documentId, assetId })).dataUri
        : prepared;
  }
  const previews = createDocumentPreviewReader(input.database);
  const available = new Set(
    listDocumentPreviewTypes()
      .filter(type => type.enabled)
      .map(type => type.nodeType)
  );
  for (const targetId of new Set(input.documentIds)) {
    input.signal.throwIfAborted();
    documents[targetId] = await readDocumentCover(input, targetId, available, previews);
  }
  input.signal.throwIfAborted();
  refreshResourceTitles(
    input.database,
    input.documentId,
    documents,
    new Set(
      listDocumentPreviewTypes()
        .filter(type => type.enabled)
        .map(type => type.nodeType)
    )
  );
  return { assets, documents };
}
export async function readCanvasRenderingResources(input: {
  readonly database: CanvasDatabase;
  readonly snapshot: CanvasSnapshot;
  readonly signal: AbortSignal;
  readonly covers: boolean;
}) {
  const resources = await readCanvasResources({
    ...input,
    documentId: input.snapshot.documentId,
    assetIds: collectCanvasAssetIds(input.snapshot.elements),
    documentIds: listCanvasReferencedDocuments(input.snapshot.elements),
  });
  const tags = readCanvasTagNames(input.database, input.snapshot.elements);
  return { ...resources, tags: Object.fromEntries(tags) };
}
