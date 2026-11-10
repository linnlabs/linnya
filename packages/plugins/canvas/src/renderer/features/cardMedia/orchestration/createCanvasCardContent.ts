import { JsonValueSchema } from '@app/schemas';
import { createMarkdownDocumentFragment } from '@linnya/markdown-document-core';
import type { CanvasCardContent, CanvasCardMediaPort } from '../definitions/cardMedia';
import { RENDERER_UI_THEME_ATTRIBUTE } from '@linnya/renderer-ui/theme';
import { createCanvasContentNotifications } from './createCanvasContentNotifications';
import { createCanvasReferenceMetadata } from './createCanvasReferenceMetadata';
import { createCanvasImageSources } from './createCanvasImageSources';
import { createCanvasDocumentPreviews } from './createCanvasDocumentPreviews';
import { canvasReferencedDocuments } from '../functions/canvasReferencedDocuments';
import {
  hydrateCanvasDocumentTags,
  hydrateCanvasManagedImages,
  createCanvasImageSurface,
  createCanvasDocumentSurface,
  canvasDocumentPreviewMessage,
} from '../../cardRendering/content';
import { canvasText } from '../../localization';

const previewFailure = (status: Parameters<typeof canvasDocumentPreviewMessage>[0]) =>
  new Error(canvasDocumentPreviewMessage(status) || canvasText('canvas.error.documentNotOpenable'));
const hydrateDocumentTags = (
  element: HTMLElement,
  presentations: Parameters<typeof hydrateCanvasDocumentTags>[1]
) =>
  hydrateCanvasDocumentTags(element, presentations, canvasText('canvas.error.documentUnavailable'));

/** 内容投影只持有有界资源缓存；文档与图片的持久身份仍归各自owner。 */
export function createCanvasCardContent(
  documentId: string,
  port: CanvasCardMediaPort
): CanvasCardContent {
  const metadata = createCanvasReferenceMetadata(port);
  const images = createCanvasImageSources(documentId, port);
  const notifications = createCanvasContentNotifications();
  const changed = notifications.changed;
  const previews = createCanvasDocumentPreviews(port, metadata, changed);
  const stopMetadata = metadata.subscribe(change => {
    if (change.kind === 'invalidated') {
      notifications.invalidate();
    } else changed(change.kind === 'failed' ? change.error : null);
    previews.refresh();
  });
  return {
    stageImage: images.stage,
    releaseStagedImages: images.release,
    resolveImageSource: images.resolve,
    async create(card, signal) {
      signal.throwIfAborted();
      const element = document.createElement('div');
      element.className = 'markdown-document-content canvas-card-content';
      if (card.type === 'text') {
        element.append(
          createMarkdownDocumentFragment(JsonValueSchema.parse(card.data.content), document)
        );
        const assets: Record<string, string> = {},
          presentations: Record<string, { title: string }> = {};
        await Promise.all(
          Array.from(element.querySelectorAll('img'), async img => {
            const assetId = img.getAttribute('data-asset-id');
            if (assetId) assets[assetId] = await images.read(assetId);
          })
        );
        await Promise.all(
          canvasReferencedDocuments(card).map(async id => {
            const reference = await metadata.read(id);
            if (
              (reference.status === 'available' || reference.status === 'plugin_unavailable') &&
              reference.title
            )
              presentations[id] = { title: reference.title };
          })
        );
        signal.throwIfAborted();
        hydrateCanvasManagedImages(element, assets);
        hydrateDocumentTags(element, presentations);
      }
      if (card.type === 'image') {
        const source = await images.read(card.data.assetId);
        signal.throwIfAborted();
        return createCanvasImageSurface(card, source, document);
      }
      if (card.type === 'document') {
        const result = await previews.read(card);
        signal.throwIfAborted();
        const body = result.content?.detail;
        const icon = result.nodeType ? (port.typeIcon?.(result.nodeType) ?? null) : null;
        return createCanvasDocumentSurface(
          {
            title: result.title,
            status: result.status,
            summary: result.content?.summary,
            image: result.content?.image?.dataUri,
            ...(body ? { body } : {}),
            ...(result.content?.overview === 'thumbnail' ? { thumbnail: true } : {}),
            ...(icon ? { icon } : {}),
          },
          {
            document,
            card: {
              documentId: card.data.documentId,
              width: card.width,
              height: card.height,
              color: card.color,
            },
            signal,
            theme:
              document.documentElement.getAttribute(RENDERER_UI_THEME_ATTRIBUTE) === 'dark'
                ? 'dark'
                : 'light',
          }
        );
      }
      return element;
    },
    async open(card, opening) {
      if (card.type !== 'document') return;
      const result = await previews.read(card);
      if (result.status !== 'ready' || !result.nodeType) throw previewFailure(result.status);
      // 身份已通过正式预览复核；在导航卸载当前表面前通知调用方记录已查看。
      opening?.(card.id);
      await port.openDocument(card.data.documentId, result.nodeType, result.title);
    },
    documentTitles: metadata.titles,
    async documentIcon(card) {
      if (card.type !== 'document') return null;
      const result = await previews.read(card);
      return result.nodeType ? (port.typeIcon?.(result.nodeType) ?? null) : null;
    },
    contentKey: card => `${metadata.key(card)}:${previews.key(card)}`,
    refreshReferences: async cards => {
      previews.setCards(cards);
      await metadata.refresh(cards);
    },
    refreshVisible: previews.refreshVisible,
    thumbnailCards: previews.thumbnails,
    retry: previews.retry,
    subscribe: notifications.subscribe,
    dispose() {
      notifications.dispose();
      stopMetadata();
      metadata.dispose();
      previews.dispose();
      images.dispose();
    },
  };
}
