import type { CanvasPoint, CanvasRectangle } from '../../../shared';

/** 线段在 [t0,t1] 内落进矩形的参数区间（Liang–Barsky）；不相交返回 null。 */
function clipSegment(
  a: CanvasPoint,
  b: CanvasPoint,
  rect: CanvasRectangle
): readonly [number, number] | null {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  let t0 = 0,
    t1 = 1;
  const edges: readonly (readonly [number, number])[] = [
    [-dx, a.x - rect.x],
    [dx, rect.x + rect.width - a.x],
    [-dy, a.y - rect.y],
    [dy, rect.y + rect.height - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q <= 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return null;
  }
  return [t0, t1];
}

function covered(point: CanvasPoint, regions: readonly CanvasRectangle[]): boolean {
  return regions.some(
    rect =>
      point.x > rect.x &&
      point.x < rect.x + rect.width &&
      point.y > rect.y &&
      point.y < rect.y + rect.height
  );
}

/** 线段上没被任何卡片挡住的参数区间，按 t 升序。 */
function visibleIntervals(
  a: CanvasPoint,
  b: CanvasPoint,
  regions: readonly CanvasRectangle[]
): (readonly [number, number])[] {
  const hidden = regions
    .map(rect => clipSegment(a, b, rect))
    .filter((range): range is readonly [number, number] => range !== null)
    .sort((left, right) => left[0] - right[0]);
  let cursor = 0;
  const visible: (readonly [number, number])[] = [];
  for (const [from, to] of hidden) {
    if (from > cursor) visible.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < 1) visible.push([cursor, 1]);
  return visible;
}

/** 沿折线露在外面的最长一段（跨线段首尾相接的部分算同一段），以弧长起点与长度表示。 */
function longestVisibleRun(
  points: readonly CanvasPoint[],
  regions: readonly CanvasRectangle[]
): { readonly start: number; readonly length: number } | null {
  let best: { readonly start: number; readonly length: number } | null = null;
  let runStart = 0,
    runLength = 0,
    travelled = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1],
      b = points[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    for (const [from, to] of visibleIntervals(a, b, regions)) {
      const start = travelled + from * length;
      if (runLength === 0 || Math.abs(runStart + runLength - start) > 1e-6) {
        runStart = start;
        runLength = 0;
      }
      runLength += (to - from) * length;
      if (!best || runLength > best.length) best = { start: runStart, length: runLength };
    }
    travelled += length;
  }
  return best;
}

function pointAtDistance(points: readonly CanvasPoint[], target: number): CanvasPoint | null {
  let walked = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1],
      b = points[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (walked + length >= target) {
      const ratio = length ? (target - walked) / length : 0;
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
    }
    walked += length;
  }
  return points[points.length - 1] ?? null;
}

/**
 * 连线标签的世界坐标锚点。线画在卡片下方，标签画在最上层：几何中点落进卡片时，
 * 标签会盖住正文。中点露在外面就用中点；否则取线上露在卡片外最长一段的中点；整条线都被挡住时不画标签。
 * regions 为卡片纸面在世界坐标里的可见区域（与连线淡影遮罩同源）。
 */
export function canvasLineLabelAnchor(
  points: readonly CanvasPoint[],
  midpoint: CanvasPoint,
  regions: readonly CanvasRectangle[]
): CanvasPoint | null {
  if (!covered(midpoint, regions)) return midpoint;
  const run = longestVisibleRun(points, regions);
  return run && run.length >= 1 ? pointAtDistance(points, run.start + run.length / 2) : null;
}
