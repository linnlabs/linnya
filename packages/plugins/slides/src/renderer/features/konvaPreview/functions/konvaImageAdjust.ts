import { applyImageAdjustToPixels, type ImageAdjust } from '@plugin/slides/shared/deckSpec/imageAdjust';

const adjustedSources = new WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>();

/**
 * 调色在图片加载后按 PowerPoint 的公式算一次像素，结果按原图和参数缓存；不用 Konva 滤镜，
 * 免得每次重绘都 cache() 再逐像素算。画布与原图同尺寸，裁切和取景坐标不变。
 */
export function resolveAdjustedImageSource(
  image: HTMLImageElement,
  adjust: ImageAdjust | undefined,
): HTMLImageElement | HTMLCanvasElement {
  if (!adjust) return image;
  const key = JSON.stringify(adjust);
  let entries = adjustedSources.get(image);
  if (!entries) {
    entries = new Map();
    adjustedSources.set(image, entries);
  }
  const cached = entries.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return image;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  applyImageAdjustToPixels(pixels.data, adjust);
  context.putImageData(pixels, 0, 0);
  entries.set(key, canvas);
  return canvas;
}
