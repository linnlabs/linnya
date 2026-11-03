import { JsonValueSchema } from '@app/schemas';
import { createMarkdownDocumentFragment } from '@linnya/markdown-document-core';
import type { CanvasCardContent, CanvasCardMediaPort } from '../definitions/cardMedia';
import { createCanvasReferenceMetadata } from './createCanvasReferenceMetadata';
import { createCanvasImageSources } from './createCanvasImageSources';
import { createCanvasDocumentPreviews } from './createCanvasDocumentPreviews';
import { canvasReferencedDocuments } from '../functions/canvasReferencedDocuments';
import { hydrateCanvasDocumentTags, hydrateCanvasManagedImages, createCanvasImageSurface } from '../../cardRendering/content';

const statuses = { deleted: '文档已删除', outside_project: '目标在其他项目，当前不可访问', plugin_unavailable: '需要启用或安装文档插件', preview_unavailable: '暂时没有可用预览', ready: '' };
/** 内容投影只持有有界资源缓存；文档与图片的持久身份仍归各自owner。 */
export function createCanvasCardContent(documentId: string, port: CanvasCardMediaPort): CanvasCardContent {
  const metadata = createCanvasReferenceMetadata(port);
  const images = createCanvasImageSources(documentId, port);
  const listeners = new Set<(failure: Error | null) => void>(), changed = (failure: Error | null) => { for (const listener of listeners) listener(failure); };
  const previews = createCanvasDocumentPreviews(port, metadata.version, changed);
  const stopMetadata = metadata.subscribe(failure => { previews.refresh(); changed(failure); });
  return {
    stageImage: images.stage, releaseStagedImages: images.release, resolveImageSource: images.resolve,
    async create(card, signal) {
      signal.throwIfAborted();
      const element = document.createElement('div'); element.className = 'markdown-document-content canvas-card-content';
      if (card.type === 'text') {
        element.append(createMarkdownDocumentFragment(JsonValueSchema.parse(card.data.content), document));
        const assets: Record<string, string> = {}, presentations: Record<string, { title: string }> = {};
        await Promise.all(Array.from(element.querySelectorAll('img'), async img => { const assetId = img.getAttribute('data-asset-id'); if (assetId) assets[assetId] = await images.read(assetId); }));
        await Promise.all(canvasReferencedDocuments(card).map(async id => { const reference = await metadata.read(id); if ((reference.status === 'available' || reference.status === 'plugin_unavailable') && reference.title) presentations[id] = { title: reference.title }; }));
        signal.throwIfAborted(); hydrateCanvasManagedImages(element, assets); hydrateCanvasDocumentTags(element, presentations);
      }
      if (card.type === 'image') {
        const source = await images.read(card.data.assetId); signal.throwIfAborted();
        return createCanvasImageSurface(card, source, document);
      }
      if (card.type === 'document') {
        const result = await previews.read(card); signal.throwIfAborted();
        const title = document.createElement('strong'); title.className = 'canvas-card-title'; title.textContent = result.title ?? '文档'; element.append(title);
        if (result.content?.image) { const img = document.createElement('img'); img.src = result.content.image.dataUri; img.alt = result.title ?? ''; element.append(img); }
        else { const summary = document.createElement('p'); summary.textContent = result.content?.summary ?? statuses[result.status]; element.append(summary); }
        if (result.status !== 'ready') { const message = document.createElement('small'); message.className = 'canvas-card-auxiliary'; message.textContent = statuses[result.status]; element.append(message); }
      }
      return element;
    },
    async open(card) {
      if (card.type !== 'document') return;
      const result = await previews.read(card);
      if (result.status !== 'ready' || !result.nodeType) throw new Error(statuses[result.status] || '文档不可打开');
      await port.openDocument(card.data.documentId, result.nodeType, result.title);
    },
    documentTitles: metadata.titles, contentKey: card => `${metadata.key(card)}:${previews.key(card)}`,
    refreshReferences: async cards => { previews.setCards(cards); await metadata.refresh(cards); }, refreshVisible: previews.refreshVisible, thumbnailCards: previews.thumbnails, retry: previews.retry,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { stopMetadata(); metadata.dispose(); previews.dispose(); images.dispose(); listeners.clear(); },
  };
}
