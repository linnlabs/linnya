import type { CanvasCard, CanvasSnapshot } from '../../../../shared';
import { CanvasCheckReportSchema } from '../../../../shared/query/definitions/canvasCheck';
import { checkCanvasCardOverlaps, readCanvasCardOutliers } from './checkCanvasCardGeometry';
import { checkCanvasEdgeCrossings, readCanvasCheckedEdgeGeometry } from './checkCanvasEdgeGeometry';

export function checkCanvas(snapshot: CanvasSnapshot) {
  const cards = snapshot.elements.filter((element): element is CanvasCard => element.type !== 'edge');
  const edges = snapshot.elements.filter(element => element.type === 'edge');
  const overlaps = checkCanvasCardOverlaps(cards), geometry = readCanvasCheckedEdgeGeometry(cards, edges);
  const crossings = checkCanvasEdgeCrossings(geometry.entries);
  return CanvasCheckReportSchema.parse({ sequence: snapshot.sequence, cardCount: cards.length, edgeCount: edges.length,
    overlapCount: overlaps.total, crossingCount: crossings.total, overlaps: overlaps.samples, crossings: crossings.samples,
    longEdges: geometry.longEdges, outliers: readCanvasCardOutliers(cards),
    note: '线交叉按正式曲线的100%缩放折线几何检查；过长>2000，离群>中位半径4倍且>2000。' });
}
