import type { CanvasPoint } from '../definitions/canvasGeometry';

type Cubic = readonly [CanvasPoint, CanvasPoint, CanvasPoint, CanvasPoint];
const half = (a: CanvasPoint, b: CanvasPoint): CanvasPoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
function distanceSquared(point: CanvasPoint, a: CanvasPoint, b: CanvasPoint): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const ratio = length
    ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
    : 0;
  return (point.x - a.x - dx * ratio) ** 2 + (point.y - a.y - dy * ratio) ** 2;
}

/** Bézier在控制点凸包内；控制点距弦段≤1/4屏幕像素时即可用该段，不按长直线长度浪费顶点。 */
export function flattenCanvasCubic(curve: Cubic, zoom: number): readonly CanvasPoint[] {
  const toleranceSquared = (0.25 / zoom) ** 2,
    points: CanvasPoint[] = [curve[0]];
  const pending: Cubic[] = [curve];
  for (let current = pending.pop(); current; current = pending.pop()) {
    const [a, b, c, d] = current;
    if (Math.max(distanceSquared(b, a, d), distanceSquared(c, a, d)) <= toleranceSquared) {
      points.push(d);
      continue;
    }
    const ab = half(a, b),
      bc = half(b, c),
      cd = half(c, d),
      abc = half(ab, bc),
      bcd = half(bc, cd),
      middle = half(abc, bcd);
    pending.push([middle, bcd, cd, d], [a, ab, abc, middle]);
  }
  return points;
}
