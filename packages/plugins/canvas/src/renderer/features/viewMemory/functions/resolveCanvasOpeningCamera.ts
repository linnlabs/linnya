import type { CanvasCamera, CanvasElement } from '@plugin/canvas/shared';
import { canvasFitCamera } from '../../../kernel/navigation';

/** 打开画布时的视口：本机记得上次位置就回到那里；第一次打开则把全部卡片放进视口。 */
export function resolveCanvasOpeningCamera(
  remembered: CanvasCamera | null,
  elements: readonly CanvasElement[],
  viewport: { readonly width: number; readonly height: number }
): CanvasCamera | null {
  if (remembered) return remembered;
  if (viewport.width <= 0 || viewport.height <= 0) return null;
  return canvasFitCamera(
    elements.filter(element => element.type !== 'edge'),
    viewport
  );
}
