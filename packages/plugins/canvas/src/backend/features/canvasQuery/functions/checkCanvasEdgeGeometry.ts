import { canvasBounds, canvasRectanglesOverlap, layoutCanvasEdges, type CanvasCard, type CanvasEdge, type CanvasPoint } from '../../../../shared';
import type { CanvasCheckedEdgeGeometry, CanvasGeometryPairReport } from '../definitions/canvasGeometryChecks';
function orientation(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint): number { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function intersects(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint, d: CanvasPoint): boolean {
  return orientation(a, b, c) * orientation(a, b, d) < 0 && orientation(c, d, a) * orientation(c, d, b) < 0;
}
function pathsCross(a: readonly CanvasPoint[], b: readonly CanvasPoint[]): boolean {
  for (let p = 1; p < a.length; p++) for (let q = 1; q < b.length; q++) {
    if (intersects(a[p - 1], a[p], b[q - 1], b[q])) return true;
  }
  return false;
}
export function readCanvasCheckedEdgeGeometry(cards: readonly CanvasCard[], edges: readonly CanvasEdge[]) {
  const geometry = layoutCanvasEdges(edges, new Map(cards.map(card => [card.id, card])), 1), longEdges: string[] = [];
  const entries: CanvasCheckedEdgeGeometry[] = edges.map(edge => {
    const points = geometry.get(edge.id)?.points;
    if (!points) throw new Error('canvas_edge_geometry_missing');
    const length = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
    if (length > 2000) longEdges.push(edge.id);
    const bounds = canvasBounds(points.map(point => ({ ...point, width: 0.001, height: 0.001 })));
    if (!bounds) throw new Error('canvas_edge_geometry_empty');
    return { id: edge.id, points, bounds };
  });
  return { entries, longEdges };
}
/** 与前台共用正式曲线采样；端点接触不计交叉，一对线只计一次。 */
export function checkCanvasEdgeCrossings(geometry: readonly CanvasCheckedEdgeGeometry[]): CanvasGeometryPairReport {
  const entries = [...geometry].sort((a, b) => a.bounds.x - b.bounds.x), samples: string[][] = [];
  let total = 0;
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length && entries[j].bounds.x <= entries[i].bounds.x + entries[i].bounds.width; j++) {
    const a = entries[i], b = entries[j];
    if (!canvasRectanglesOverlap(a.bounds, b.bounds) || !pathsCross(a.points, b.points)) continue;
    total++; if (samples.length < 100) samples.push([a.id, b.id]);
  }
  return { total, samples };
}
