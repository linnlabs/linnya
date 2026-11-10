import type { CanvasCard } from '../../../../shared';

/** 只投影受信显示源；资产准备/权限在调用方完成，裁剪不改变原始资产。 */
export function createCanvasImageSurface(
  card: Extract<CanvasCard, { type: 'image' }>,
  source: string,
  document: Document
): HTMLElement {
  const element = document.createElement('div');
  element.className = 'markdown-document-content canvas-card-content canvas-image-content';
  // tile source本身是auto-height；必须固定完整卡框，竖裁后图注才能仍锚在可见底部。
  element.style.height = `${card.height}px`;
  const image = document.createElement('img');
  image.src = source;
  image.alt = card.data.alt;
  image.className = 'canvas-media-image';
  const crop = card.data.crop;
  if (crop) {
    image.style.width = `${100 / crop.width}%`;
    image.style.height = `${100 / crop.height}%`;
    image.style.maxWidth = 'none';
    image.style.objectFit = 'fill';
    image.style.transform = `translate(${-crop.x * 100}%, ${-crop.y * 100}%)`;
  }
  element.append(image);
  if (card.data.caption) {
    const caption = document.createElement('p');
    caption.className = 'canvas-image-caption';
    caption.textContent = card.data.caption;
    element.append(caption);
  }
  return element;
}
