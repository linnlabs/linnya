import { JsonValueSchema } from '@app/schemas';
import { createMarkdownDocumentFragment } from '@linnya/markdown-document-core';
import type { CanvasCardContent, CanvasCardMediaPort } from '../definitions/cardMedia';
import { CANVAS_CONTENT_NOTIFICATION_INTERVAL_MS } from '../definitions/cardMedia';
import { createCanvasReferenceMetadata } from './createCanvasReferenceMetadata';
import { createCanvasImageSources } from './createCanvasImageSources';
import { createCanvasDocumentPreviews } from './createCanvasDocumentPreviews';
import { canvasReferencedDocuments } from '../functions/canvasReferencedDocuments';
import { hydrateCanvasDocumentTags, hydrateCanvasManagedImages, createCanvasImageSurface, createCanvasDocumentSurface, canvasDocumentPreviewMessage } from '../../cardRendering/content';

/** 内容投影只持有有界资源缓存；文档与图片的持久身份仍归各自owner。 */
export function createCanvasCardContent(documentId: string, port: CanvasCardMediaPort): CanvasCardContent {
  const metadata = createCanvasReferenceMetadata(port);
  const images = createCanvasImageSources(documentId, port);
  const listeners = new Set<(failure: Error | null) => void>(), notify = (failure: Error | null) => { for (const listener of listeners) listener(failure); };
  let notification: ReturnType<typeof setTimeout> | null = null;
  const cancelNotification = () => { if (notification !== null) clearTimeout(notification); notification = null; };
  const changed = (failure: Error | null) => {
    if (failure) { notify(failure); return; }
    // 资源读取继续推进；短工作任务合并完成事实，正文计算始终留在绘制RAF之外。
    if (notification === null) notification = setTimeout(() => { notification = null; notify(null); }, CANVAS_CONTENT_NOTIFICATION_INTERVAL_MS);
  };
  const previews = createCanvasDocumentPreviews(port, metadata, changed);
  const stopMetadata = metadata.subscribe(change => {
    if (change.kind === 'invalidated') { cancelNotification(); notify(null); }
    else changed(change.kind === 'failed' ? change.error : null);
    previews.refresh();
  });
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
        return createCanvasDocumentSurface({ title: result.title, status: result.status, summary: result.content?.summary, image: result.content?.image?.dataUri }, document);
      }
      return element;
    },
    async open(card, opening) {
      if (card.type !== 'document') return;
      const result = await previews.read(card);
      if (result.status !== 'ready' || !result.nodeType) throw new Error(canvasDocumentPreviewMessage(result.status) || '文档不可打开');
      // 身份已通过正式预览复核；在导航卸载当前表面前通知调用方记录已查看。
      opening?.(card.id);
      await port.openDocument(card.data.documentId, result.nodeType, result.title);
    },
    documentTitles: metadata.titles, contentKey: card => `${metadata.key(card)}:${previews.key(card)}`,
    refreshReferences: async cards => { previews.setCards(cards); await metadata.refresh(cards); }, refreshVisible: previews.refreshVisible, thumbnailCards: previews.thumbnails, retry: previews.retry,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { cancelNotification(); stopMetadata(); metadata.dispose(); previews.dispose(); images.dispose(); listeners.clear(); },
  };
}
