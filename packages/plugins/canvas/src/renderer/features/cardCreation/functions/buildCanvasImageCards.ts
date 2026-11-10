import {
  canvasDefaultImageSize,
  type CanvasCommand,
  type CanvasPoint,
} from '@plugin/canvas/shared';
import type { CanvasPreparedImage } from '../definitions/cardCreation';
export function buildCanvasImageCards(
  images: readonly CanvasPreparedImage[],
  point: CanvasPoint
): readonly CanvasCommand[] {
  return images.map((image, index) => ({
    op: 'addImage',
    ref: `$image${index}`,
    ...canvasDefaultImageSize(image),
    x: point.x + index * 24,
    y: point.y + index * 24,
    data: { assetId: image.assetId, caption: '', alt: '', crop: null },
  }));
}
