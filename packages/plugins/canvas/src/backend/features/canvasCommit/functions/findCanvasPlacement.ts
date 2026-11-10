import type {
  CanvasPoint,
  CanvasRectangle,
} from '../../../../shared/geometry/definitions/canvasGeometry';
import { canvasRectanglesOverlap } from '../../../../shared/geometry/functions/canvasGeometry';

function placementOrigin(input: {
  readonly width: number;
  readonly height: number;
  readonly near: CanvasRectangle | undefined;
  readonly origin?: CanvasPoint;
  readonly side: 'right' | 'left' | 'top' | 'bottom';
}): CanvasPoint {
  if (input.origin) return input.origin;
  const near = input.near;
  if (!near) return { x: 0, y: 0 };
  const gap = 32;
  switch (input.side) {
    case 'right':
      return { x: near.x + near.width + gap, y: near.y };
    case 'left':
      return { x: near.x - input.width - gap, y: near.y };
    case 'bottom':
      return { x: near.x, y: near.y + near.height + gap };
    case 'top':
      return { x: near.x, y: near.y - input.height - gap };
  }
}

export function findCanvasPlacement(input: {
  readonly width: number;
  readonly height: number;
  readonly near: CanvasRectangle | undefined;
  readonly origin?: CanvasPoint;
  readonly side: 'right' | 'left' | 'top' | 'bottom';
  readonly occupied: readonly CanvasRectangle[];
}): CanvasPoint {
  const { width, height, side, occupied } = input;
  const gap = 32;
  let { x, y } = placementOrigin(input);
  // 每次越过至少一个障碍物的边界；搜索只扩展新卡，不移动现有卡。
  for (;;) {
    const obstruction = occupied.find(rect =>
      canvasRectanglesOverlap({ x, y, width, height }, rect, gap)
    );
    if (!obstruction) return { x, y };
    if (side === 'left') x = obstruction.x - width - gap;
    else if (side === 'top') y = obstruction.y - height - gap;
    else if (side === 'bottom') y = obstruction.y + obstruction.height + gap;
    else x = obstruction.x + obstruction.width + gap;
  }
}
