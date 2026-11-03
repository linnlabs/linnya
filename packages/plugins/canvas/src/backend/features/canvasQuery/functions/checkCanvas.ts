import { canvasBounds, canvasRectanglesOverlap, layoutCanvasEdges, type CanvasCard, type CanvasSnapshot, type CanvasPoint } from '../../../../shared';
import { CanvasCheckReportSchema } from '../../../../shared/query/definitions/canvasCheck';
function orientation(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint): number { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function intersects(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint, d: CanvasPoint): boolean {
  return orientation(a, b, c) * orientation(a, b, d) < 0 && orientation(c, d, a) * orientation(c, d, b) < 0;
}
export function checkCanvas(snapshot: CanvasSnapshot) {
  const cards = snapshot.elements.filter((element): element is CanvasCard => element.type !== 'edge');
  const edges = snapshot.elements.filter(element => element.type === 'edge');
  const geometry = layoutCanvasEdges(edges, new Map(cards.map(card => [card.id, card])), 1);
  const overlaps: string[][] = [], crossings: string[][] = [], longEdges: string[] = [];
  let overlapCount = 0, crossingCount = 0;
  const cardOrder = [...cards].sort((a, b) => a.x - b.x);
  for (let i = 0; i < cardOrder.length; i++) for (let j = i + 1; j < cardOrder.length && cardOrder[j].x < cardOrder[i].x + cardOrder[i].width; j++) {
    if (canvasRectanglesOverlap(cardOrder[i], cardOrder[j])) {
      overlapCount++; if (overlaps.length < 100) overlaps.push([cardOrder[i].id, cardOrder[j].id]);
    }
  }
  const entries = edges.map(edge => {
    const points = geometry.get(edge.id)?.points;
    if (!points) throw new Error('canvas_edge_geometry_missing');
    const length = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
    if (length > 2000) longEdges.push(edge.id);
    const bounds = canvasBounds(points.map(point => ({ ...point, width: 0.001, height: 0.001 })));
    if (!bounds) throw new Error('canvas_edge_geometry_empty');
    return { id: edge.id, points, bounds };
  }).sort((a, b) => a.bounds.x - b.bounds.x);
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length && entries[j].bounds.x <= entries[i].bounds.x + entries[i].bounds.width; j++) {
    const a = entries[i], b = entries[j];
    if (!canvasRectanglesOverlap(a.bounds, b.bounds)) continue;
    let crossed = false;
    for (let p = 1; p < a.points.length && !crossed; p++) for (let q = 1; q < b.points.length && !crossed; q++) crossed = intersects(a.points[p - 1], a.points[p], b.points[q - 1], b.points[q]);
    if (crossed) { crossingCount++; if (crossings.length < 100) crossings.push([a.id, b.id]); }
  }
  const centers = cards.map(card => ({ x: card.x + card.width / 2, y: card.y + card.height / 2 }));
  const middle = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const cx = middle(centers.map(point => point.x)), cy = middle(centers.map(point => point.y));
  const distances = centers.map(point => Math.hypot(point.x - cx, point.y - cy)), radius = middle([...distances]);
  const outliers = cards.filter((_card, index) => distances[index] > Math.max(2000, radius * 4)).map(card => card.id);
  return CanvasCheckReportSchema.parse({ sequence: snapshot.sequence, cardCount: cards.length, edgeCount: edges.length, overlapCount, crossingCount,
    overlaps, crossings, longEdges, outliers, note: '线交叉按正式曲线的100%缩放折线几何检查；过长>2000，离群>中位半径4倍且>2000。' });
}
