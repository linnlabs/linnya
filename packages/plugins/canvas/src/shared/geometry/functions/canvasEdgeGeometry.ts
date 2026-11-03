import type { CanvasCard, CanvasEdge, CanvasEdgeId, CanvasEndpoint } from '../../model/definitions/canvasElement';
import type { CanvasPoint } from '../definitions/canvasGeometry';
import type { CanvasEdgeGeometry, CanvasEdgeSide } from '../definitions/canvasEdgeGeometry';
export type { CanvasEdgeGeometry, CanvasEdgeSide } from '../definitions/canvasEdgeGeometry';
interface Anchor { point: CanvasPoint; side: CanvasEdgeSide | null; readonly card: CanvasCard | null; readonly toward: CanvasPoint }
interface EdgeAnchors { readonly edge: CanvasEdge; readonly from: Anchor; readonly to: Anchor }
const normals: Record<CanvasEdgeSide, CanvasPoint> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };
function cardFor(endpoint: CanvasEndpoint, cards: ReadonlyMap<string, CanvasCard>): CanvasCard | null {
  if (endpoint.kind === 'point') return null;
  const card = cards.get(endpoint.cardId);
  if (!card) throw new Error(`canvas_edge_card_missing:${endpoint.cardId}`);
  return card;
}
function center(endpoint: CanvasEndpoint, cards: ReadonlyMap<string, CanvasCard>): CanvasPoint {
  const card = cardFor(endpoint, cards);
  if (card) return { x: card.x + card.width / 2, y: card.y + card.height / 2 };
  if (endpoint.kind === 'point') return { x: endpoint.x, y: endpoint.y };
  throw new Error('canvas_edge_endpoint_missing');
}
function anchor(endpoint: CanvasEndpoint, cards: ReadonlyMap<string, CanvasCard>, toward: CanvasPoint, previous: CanvasEdgeSide | null): Anchor {
  const card = cardFor(endpoint, cards);
  if (!card && endpoint.kind === 'point') return { point: { x: endpoint.x, y: endpoint.y }, side: null, card, toward };
  if (!card) throw new Error('canvas_edge_card_missing');
  const cx = card.x + card.width / 2, cy = card.y + card.height / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  const horizontal = Math.abs(dx) - card.width / 2, vertical = Math.abs(dy) - card.height / 2;
  let side: CanvasEdgeSide = horizontal >= vertical ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top';
  if (endpoint.kind === 'card' && endpoint.side !== 'auto') side = endpoint.side;
  else if (previous && Math.abs(horizontal - vertical) < 24) side = previous;
  const normal = normals[side];
  return { point: { x: cx + normal.x * card.width / 2, y: cy + normal.y * card.height / 2 }, side, card, toward };
}
function anchors(edge: CanvasEdge, cards: ReadonlyMap<string, CanvasCard>, previous?: CanvasEdgeGeometry): EdgeAnchors {
  const from = anchor(edge.from, cards, center(edge.to, cards), previous?.fromSide ?? null);
  const to = anchor(edge.to, cards, center(edge.from, cards), previous?.toSide ?? null);
  return { edge, from, to };
}
function spread(entries: readonly EdgeAnchors[]): void {
  const groups = new Map<string, Anchor[]>();
  for (const entry of entries) for (const endpoint of [entry.from, entry.to]) {
    if (!endpoint.card || !endpoint.side) continue;
    const key = `${endpoint.card.id}:${endpoint.side}`;
    const group = groups.get(key) ?? []; group.push(endpoint); groups.set(key, group);
  }
  for (const endpoints of groups.values()) {
    const first = endpoints[0];
    if (!first.card || !first.side) continue;
    const horizontal = first.side === 'top' || first.side === 'bottom';
    const length = horizontal ? first.card.width : first.card.height;
    endpoints.sort((a, b) => horizontal ? a.toward.x - b.toward.x : a.toward.y - b.toward.y);
    const spacing = Math.min(16, length * 0.6 / Math.max(1, endpoints.length - 1));
    endpoints.forEach((endpoint, index) => {
      const offset = (index - (endpoints.length - 1) / 2) * spacing;
      endpoint.point = { x: endpoint.point.x + (horizontal ? offset : 0), y: endpoint.point.y + (horizontal ? 0 : offset) };
    });
  }
}
function clipStraight(endpoint: Anchor, other: CanvasPoint): CanvasPoint {
  if (!endpoint.card) return endpoint.point;
  const card = endpoint.card;
  const cx = card.x + card.width / 2, cy = card.y + card.height / 2;
  const dx = other.x - cx, dy = other.y - cy;
  if (!dx && !dy) return endpoint.point;
  const ratio = 1 / Math.max(Math.abs(dx) / (card.width / 2), Math.abs(dy) / (card.height / 2));
  return { x: cx + dx * ratio, y: cy + dy * ratio };
}
function midpoint(points: readonly CanvasPoint[]): CanvasPoint {
  let total = 0;
  const distances = points.slice(1).map((point, i) => { const distance = Math.hypot(point.x - points[i].x, point.y - points[i].y); total += distance; return distance; });
  let remaining = total / 2;
  for (let i = 0; i < distances.length; i++) {
    if (remaining <= distances[i]) {
      const ratio = distances[i] ? remaining / distances[i] : 0;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * ratio, y: points[i].y + (points[i + 1].y - points[i].y) * ratio };
    }
    remaining -= distances[i];
  }
  return points[0];
}
function geometry(entry: EdgeAnchors, zoom: number): CanvasEdgeGeometry {
  const { edge } = entry;
  let from = entry.from.point, to = entry.to.point;
  let points: readonly CanvasPoint[];
  if (edge.lineStyle === 'straight') {
    from = clipStraight(entry.from, entry.to.card ? { x: entry.to.card.x + entry.to.card.width / 2, y: entry.to.card.y + entry.to.card.height / 2 } : to);
    to = clipStraight(entry.to, entry.from.card ? { x: entry.from.card.x + entry.from.card.width / 2, y: entry.from.card.y + entry.from.card.height / 2 } : from);
    points = [from, to];
  } else if (zoom < 0.15) points = [from, to];
  else {
    const dx = to.x - from.x, dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const direction = distance ? { x: dx / distance, y: dy / distance } : { x: 1, y: 0 };
    const fromNormal = entry.from.side ? normals[entry.from.side] : direction;
    const toNormal = entry.to.side ? normals[entry.to.side] : { x: -direction.x, y: -direction.y };
    const fromControl = Math.max(24, Math.min(160, (dx * fromNormal.x + dy * fromNormal.y) / 2));
    const toControl = Math.max(24, Math.min(160, (-dx * toNormal.x - dy * toNormal.y) / 2));
    const c1 = { x: from.x + fromNormal.x * fromControl, y: from.y + fromNormal.y * fromControl };
    const c2 = { x: to.x + toNormal.x * toControl, y: to.y + toNormal.y * toControl };
    const count = Math.min(128, Math.max(2, Math.ceil(distance * zoom / 12)));
    points = Array.from({ length: count + 1 }, (_, i) => {
      const t = i / count, s = 1 - t;
      return { x: s ** 3 * from.x + 3 * s ** 2 * t * c1.x + 3 * s * t ** 2 * c2.x + t ** 3 * to.x,
        y: s ** 3 * from.y + 3 * s ** 2 * t * c1.y + 3 * s * t ** 2 * c2.y + t ** 3 * to.y };
    });
  }
  return { from, to, midpoint: midpoint(points), points, fromSide: entry.from.side, toSide: entry.to.side };
}
/** 单线纯几何；批量场景还要通过 layoutCanvasEdges 做同侧排开。 */
export function resolveCanvasEdgeGeometry(edge: CanvasEdge, cards: ReadonlyMap<string, CanvasCard>, zoom = 1): CanvasEdgeGeometry {
  return geometry(anchors(edge, cards), zoom);
}
export function layoutCanvasEdges(edges: readonly CanvasEdge[], cards: ReadonlyMap<string, CanvasCard>, zoom: number,
  previous: ReadonlyMap<CanvasEdgeId, CanvasEdgeGeometry> = new Map()): ReadonlyMap<CanvasEdgeId, CanvasEdgeGeometry> {
  const entries = edges.map(edge => anchors(edge, cards, previous.get(edge.id)));
  spread(entries);
  return new Map(entries.map(entry => [entry.edge.id, geometry(entry, zoom)]));
}
export function canvasEdgePoints(edge: CanvasEdge, cards: ReadonlyMap<string, CanvasCard>, zoom: number): readonly CanvasPoint[] {
  return resolveCanvasEdgeGeometry(edge, cards, zoom).points;
}
