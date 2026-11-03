import { createMarkdownDocumentFragment } from '@linnya/markdown-document-core';
import { JsonValueSchema } from '@app/schemas';
import type { CanvasCard } from '../../../shared';
import type { CanvasWorkerRequest, CanvasRenderRequest } from '../../../shared/rendering';
import { hydrateCanvasManagedImages, hydrateCanvasDocumentTags, installCanvasCardInk, createCanvasImageSurface } from '../../features/cardRendering/content';

export function createCardSurface(card: CanvasCard, request: CanvasRenderRequest): HTMLElement {
  const element = createSurfaceElement(card, request.assets);
  element.classList.add('markdown-document-content');
  installTypography(element, request);
  installCanvasCardInk(element, card.color, request.theme === 'dark');
  if (card.type === 'text') {
    element.append(createMarkdownDocumentFragment(JsonValueSchema.parse(card.data.content), document));
    hydrateCanvasManagedImages(element, request.assets); hydrateCanvasDocumentTags(element, request.documents);
  }
  else if (card.type === 'document') {
    const preview = request.documents[card.data.documentId];
    const title = document.createElement('p');
    title.className = 'canvas-card-title';
    title.textContent = preview?.title ?? '文档当前不可访问';
    element.append(title);
    if (preview?.image && (!preview.status || preview.status === 'available')) {
      const image = document.createElement('img'); image.src = preview.image; image.style.width = '100%'; element.append(image);
    }
  }
  return element;
}

function createSurfaceElement(card: CanvasCard, assets: CanvasRenderRequest['assets']): HTMLElement {
  if (card.type === 'image') {
    const source = assets[card.data.assetId]; if (!source) throw new Error('resource_unavailable');
    return createCanvasImageSurface(card, source, document);
  }
  const element = document.createElement('div');
  element.style.cssText = 'box-sizing:border-box;padding:16px 18px 18px;width:100%;overflow-wrap:anywhere';
  return element;
}

export function installTypography(element: HTMLElement, request: CanvasWorkerRequest): void {
  element.style.fontFamily = request.fontFamily;
  element.style.fontSize = `${request.fontSize}px`;
  element.style.lineHeight = '1.7';
  element.style.color = request.theme === 'dark' ? '#e8e9e3' : '#252c27';
  element.style.setProperty('--editor-body-font-size', `${request.fontSize}px`);
  element.style.setProperty('--editor-body-line-height', '1.7');
}
