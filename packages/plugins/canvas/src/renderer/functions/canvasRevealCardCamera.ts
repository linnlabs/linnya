import type { CanvasCamera, CanvasRectangle } from '@plugin/canvas/shared';

/** 键盘选择仅平移必要距离，不把每张卡都fit成不同倍率；长卡优先显露左上正文。 */
export function canvasRevealCardCamera(input: {
  readonly card: CanvasRectangle;
  readonly camera: CanvasCamera;
  readonly width: number;
  readonly height: number;
}): CanvasCamera {
  const { card, camera, width, height } = input,
    margin = 28;
  const left = card.x * camera.zoom + camera.x,
    top = card.y * camera.zoom + camera.y;
  const right = left + card.width * camera.zoom,
    bottom = top + card.height * camera.zoom;
  const dx =
    left < margin || card.width * camera.zoom > width - margin * 2
      ? margin - left
      : Math.min(0, width - margin - right);
  const dy =
    top < margin || card.height * camera.zoom > height - margin * 2
      ? margin - top
      : Math.min(0, height - margin - bottom);
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}
