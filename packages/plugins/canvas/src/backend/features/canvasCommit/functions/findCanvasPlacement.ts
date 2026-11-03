import type { CanvasCard } from '../../../../shared';
import type { CanvasPoint, CanvasRectangle } from '../../../../shared/geometry/definitions/canvasGeometry';
import { canvasRectanglesOverlap } from '../../../../shared/geometry/functions/canvasGeometry';

export function findCanvasPlacement(input: {
  readonly width: number; readonly height: number;
  readonly near: CanvasCard | undefined;
  readonly side: 'right' | 'left' | 'top' | 'bottom';
  readonly occupied: readonly CanvasRectangle[];
}): CanvasPoint {
  const { width, height, near, side, occupied } = input;
  const gap = 32;
  let x = near ? near.x : 0;
  let y = near ? near.y : 0;
  if (near) {
    if (side === 'right') x += near.width + gap;
    if (side === 'left') x -= width + gap;
    if (side === 'bottom') y += near.height + gap;
    if (side === 'top') y -= height + gap;
  }
  // 每次越过至少一个障碍物的边界；搜索只扩展新卡，不移动现有卡。
  for (;;) {
    const obstruction = occupied.find(rect => canvasRectanglesOverlap({ x, y, width, height }, rect, gap));
    if (!obstruction) return { x, y };
    if (side === 'left') x = obstruction.x - width - gap;
    else if (side === 'top') y = obstruction.y - height - gap;
    else if (side === 'bottom') y = obstruction.y + obstruction.height + gap;
    else x = obstruction.x + obstruction.width + gap;
  }
}
