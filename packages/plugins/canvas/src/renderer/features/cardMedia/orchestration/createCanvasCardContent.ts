import { JsonValueSchema } from '@app/schemas';
import type { DocumentImageAsset } from '@app/schemas';
import { createMarkdownDocumentFragment } from '@linnya/markdown-document-core';
import type { CanvasCard } from '@plugin/canvas/shared';
import type { CanvasCardContent, CanvasCardMediaPort } from '../definitions/cardMedia';
import { createCanvasReferenceMetadata } from './createCanvasReferenceMetadata';
import { canvasReferencedDocuments } from '../functions/canvasReferencedDocuments';
import { hydrateCanvasDocumentTags, hydrateCanvasManagedImages, resolveCanvasDisplayImages } from '../../cardRendering/content';

const statuses = { deleted: '文档已删除', outside_project: '目标在其他项目，当前不可访问', plugin_unavailable: '需要启用或安装文档插件', preview_unavailable: '暂时没有可用预览', ready: '' };
/** 内容投影只持有有界资源缓存；文档与图片的持久身份仍归各自owner。 */
export function createCanvasCardContent(documentId: string, port: CanvasCardMediaPort): CanvasCardContent {
  const metadata = createCanvasReferenceMetadata(port);
  const resources = new AbortController();
  const images = new Map<string, DocumentImageAsset>();
  let imageBytes = 0, disposed = false;
  const stageImage = (asset: DocumentImageAsset) => {
    if (images.has(asset.assetId)) return;
    while (images.size && imageBytes + asset.byteLength > 32 * 1024 * 1024) {
      const oldest = images.keys().next().value;
      if (!oldest) break;
      imageBytes -= images.get(oldest)?.byteLength ?? 0; images.delete(oldest);
    }
    if (asset.byteLength <= 32 * 1024 * 1024) { images.set(asset.assetId, asset); imageBytes += asset.byteLength; }
  };
  async function image(assetId: string) {
    const cached = images.get(assetId);
    if (cached) { images.delete(assetId); images.set(assetId, cached); return cached; }
    const asset = await port.readImage(documentId, assetId);
    if (disposed) throw new DOMException('Canvas media disposed', 'AbortError');
    stageImage(asset);
    return asset;
  }
  async function preview(card: Extract<CanvasCard, { type: 'document' }>) {
    const projectId = port.projectId();
    if (!projectId) throw new Error('没有当前项目，无法读取文档卡片');
    const result = await port.preview({ documentId: card.data.documentId, projectId, widthPx: Math.min(1600, Math.max(120, Math.round(card.width))), pixelRatio: 1 });
    if (disposed) throw new DOMException('Canvas media disposed', 'AbortError');
    return result;
  }
  const resolveImageSource = async (source: string) => {
    if (!source.startsWith('asset:')) return source;
    const asset = await image(source.slice(6)), displayed = await resolveCanvasDisplayImages({ [asset.assetId]: asset.dataUri }, resources.signal);
    const result = displayed[asset.assetId]; if (!result) throw new Error('resource_unavailable'); return result;
  };
  return {
    stageImage, resolveImageSource,
    async create(card, signal) {
      const element = document.createElement('div'); element.className = 'markdown-document-content canvas-card-content';
      if (card.type === 'text') {
        element.append(createMarkdownDocumentFragment(JsonValueSchema.parse(card.data.content), document));
        const assets: Record<string, string> = {}, presentations: Record<string, { title: string }> = {};
        await Promise.all(Array.from(element.querySelectorAll('img'), async img => { const assetId = img.getAttribute('data-asset-id'); if (assetId) assets[assetId] = (await image(assetId)).dataUri; }));
        await Promise.all(canvasReferencedDocuments(card).map(async id => { const reference = await metadata.read(id); if ((reference.status === 'available' || reference.status === 'plugin_unavailable') && reference.title) presentations[id] = { title: reference.title }; }));
        const displayed = await resolveCanvasDisplayImages(assets, signal);
        signal.throwIfAborted(); hydrateCanvasManagedImages(element, displayed); hydrateCanvasDocumentTags(element, presentations);
      }
      if (card.type === 'image') {
        const asset = await image(card.data.assetId); signal.throwIfAborted();
        const displayed = await resolveCanvasDisplayImages({ [asset.assetId]: asset.dataUri }, signal);
        const source = displayed[asset.assetId]; if (!source) throw new Error('resource_unavailable');
        const img = document.createElement('img'); img.src = source; img.alt = card.data.alt; img.className = 'canvas-media-image';
        element.classList.add('canvas-image-content');
        const crop = card.data.crop;
        if (crop) { img.style.width = `${100 / crop.width}%`; img.style.height = `${100 / crop.height}%`; img.style.maxWidth = 'none'; img.style.objectFit = 'fill'; img.style.transform = `translate(${-crop.x * 100}%, ${-crop.y * 100}%)`; }
        element.append(img);
        if (card.data.caption) { const caption = document.createElement('p'); caption.className = 'canvas-image-caption'; caption.textContent = card.data.caption; element.append(caption); }
      }
      if (card.type === 'document') {
        const result = await preview(card); signal.throwIfAborted();
        const title = document.createElement('strong'); title.className = 'canvas-card-title'; title.textContent = result.title ?? '文档'; element.append(title);
        if (result.content?.image) { const img = document.createElement('img'); img.src = result.content.image.dataUri; img.alt = result.title ?? ''; element.append(img); }
        else { const summary = document.createElement('p'); summary.textContent = result.content?.summary ?? statuses[result.status]; element.append(summary); }
        if (result.status !== 'ready') { const message = document.createElement('small'); message.className = 'canvas-card-auxiliary'; message.textContent = statuses[result.status]; element.append(message); }
      }
      return element;
    },
    async open(card) {
      if (card.type !== 'document') return;
      const result = await preview(card);
      if (result.status !== 'ready' || !result.nodeType) throw new Error(statuses[result.status] || '文档不可打开');
      await port.openDocument(card.data.documentId, result.nodeType, result.title);
    },
    documentTitles: metadata.titles, contentKey: metadata.key, refreshReferences: metadata.refresh, subscribe: metadata.subscribe,
    dispose() { disposed = true; resources.abort(); metadata.dispose(); images.clear(); imageBytes = 0; },
  };
}
