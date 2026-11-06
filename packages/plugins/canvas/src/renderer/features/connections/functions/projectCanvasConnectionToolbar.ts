import type { CanvasElement, CanvasPoint } from '@plugin/canvas/shared';
import type { CanvasConnectionToolbarInput } from '../definitions/canvasConnections';
import { canvasConnectionToolbarPosition } from './canvasConnectionToolbarPosition';

/** 正式几何、卡框与标签在同一相机下投影，浮条不另行推算世界空间路径。 */
export function projectCanvasConnectionToolbar(
  input: CanvasConnectionToolbarInput,
  elements: readonly CanvasElement[],
  label: string
) {
  const project = (point: CanvasPoint) => ({
    x: input.camera.x + point.x * input.camera.zoom,
    y: input.camera.y + point.y * input.camera.zoom,
  });
  const midpoint = project(input.geometry.midpoint);
  const cards = elements.flatMap(card =>
    card.type === 'edge'
      ? []
      : [
          {
            ...project(card),
            width: card.width * input.camera.zoom,
            height: card.height * input.camera.zoom,
          },
        ]
  );
  return canvasConnectionToolbarPosition({
    ...input,
    midpoint,
    cards,
    line: input.geometry.points.map(project),
    label: label ? { x: midpoint.x - 100, y: midpoint.y - 12, width: 200, height: 24 } : null,
  });
}
