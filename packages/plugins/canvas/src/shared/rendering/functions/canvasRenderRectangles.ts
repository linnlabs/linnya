import type { CanvasElement } from '../../model/definitions/canvasElement';
import type { CanvasRectangle } from '../../geometry/definitions/canvasGeometry';

/** 整图出图也包含悬空端点，只有线的画布不能因没有卡片而fit到空原点。 */
export function canvasRenderRectangles(elements: readonly CanvasElement[]): CanvasRectangle[] {
  return elements.flatMap(element =>
    element.type !== 'edge'
      ? [element]
      : [element.from, element.to].flatMap(endpoint =>
          endpoint.kind === 'point'
            ? [{ x: endpoint.x, y: endpoint.y, width: 0.01, height: 0.01 }]
            : []
        )
  );
}
