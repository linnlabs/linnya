import type {
  CanvasCard,
  CanvasEdge,
  CanvasEdgeId,
  CanvasEndpoint,
} from '../../model/definitions/canvasElement';
import type { CanvasPoint } from '../definitions/canvasGeometry';
import type { CanvasEdgeGeometry, CanvasEdgeSide } from '../definitions/canvasEdgeGeometry';
import { flattenCanvasCubic } from './flattenCanvasCubic';
export type { CanvasEdgeGeometry, CanvasEdgeSide } from '../definitions/canvasEdgeGeometry';
interface Anchor {
  point: CanvasPoint;
  readonly origin: CanvasPoint;
  side: CanvasEdgeSide | null;
  readonly card: CanvasCard | null;
  readonly toward: CanvasPoint;
  readonly edgeId: CanvasEdgeId;
}
interface EdgeAnchors {
  readonly edge: CanvasEdge;
  readonly from: Anchor;
  readonly to: Anchor;
}
const normals: Record<CanvasEdgeSide, CanvasPoint> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};
function cardFor(
  endpoint: CanvasEndpoint,
  cards: ReadonlyMap<string, CanvasCard>
): CanvasCard | null {
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
function anchor(
  endpoint: CanvasEndpoint,
  cards: ReadonlyMap<string, CanvasCard>,
  toward: CanvasPoint,
  options: { readonly edgeId: CanvasEdgeId; readonly previous: CanvasEdgeSide | null }
): Anchor {
  const { edgeId, previous } = options;
  const card = cardFor(endpoint, cards);
  if (!card && endpoint.kind === 'point') {
    const point = { x: endpoint.x, y: endpoint.y };
    return { edgeId, origin: point, point, side: null, card, toward };
  }
  if (!card) throw new Error('canvas_edge_card_missing');
  const cx = card.x + card.width / 2,
    cy = card.y + card.height / 2;
  const dx = toward.x - cx,
    dy = toward.y - cy;
  const horizontal = Math.abs(dx) - card.width / 2,
    vertical = Math.abs(dy) - card.height / 2;
  let side: CanvasEdgeSide =
    horizontal >= vertical ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';
  if (endpoint.kind === 'card' && endpoint.side !== 'auto') side = endpoint.side;
  else if (previous && Math.abs(horizontal - vertical) < 24) side = previous;
  const normal = normals[side];
  const point = { x: cx + (normal.x * card.width) / 2, y: cy + (normal.y * card.height) / 2 };
  return { edgeId, origin: point, point, side, card, toward };
}
function anchors(
  edge: CanvasEdge,
  cards: ReadonlyMap<string, CanvasCard>,
  previous?: CanvasEdgeGeometry
): EdgeAnchors {
  const from = anchor(edge.from, cards, center(edge.to, cards), {
    edgeId: edge.id,
    previous: previous?.fromSide ?? null,
  });
  const to = anchor(edge.to, cards, center(edge.from, cards), {
    edgeId: edge.id,
    previous: previous?.toSide ?? null,
  });
  return { edge, from, to };
}
function anchorGroup(endpoint: Anchor): string | null {
  return endpoint.card && endpoint.side ? `${endpoint.card.id}:${endpoint.side}` : null;
}
function groupAnchors(entries: Iterable<EdgeAnchors>): Map<string, Anchor[]> {
  const groups = new Map<string, Anchor[]>();
  for (const entry of entries)
    for (const endpoint of [entry.from, entry.to]) {
      const key = anchorGroup(endpoint);
      if (!key) continue;
      const group = groups.get(key) ?? [];
      group.push(endpoint);
      groups.set(key, group);
    }
  return groups;
}
function removeAnchorFromGroup(
  endpoint: Anchor,
  groups: Map<string, Anchor[]>,
  touched: Set<string>
): void {
  const key = anchorGroup(endpoint);
  if (!key) return;
  const group = groups.get(key);
  if (!group) throw new Error('canvas_edge_layout_group_missing');
  group.splice(group.indexOf(endpoint), 1);
  if (!group.length) groups.delete(key);
  touched.add(key);
}
function registerAnchorInGroup(
  endpoint: Anchor,
  groups: Map<string, Anchor[]>,
  touched: Set<string>
): void {
  const key = anchorGroup(endpoint);
  if (!key) return;
  const group = groups.get(key) ?? [];
  group.push(endpoint);
  groups.set(key, group);
  touched.add(key);
}
function spread(groups: Iterable<Anchor[]>): void {
  for (const endpoints of groups) {
    const first = endpoints[0];
    if (!first.card || !first.side) continue;
    const horizontal = first.side === 'top' || first.side === 'bottom';
    const length = horizontal ? first.card.width : first.card.height;
    endpoints.sort(
      (a, b) =>
        (horizontal ? a.toward.x - b.toward.x : a.toward.y - b.toward.y) ||
        a.edgeId.localeCompare(b.edgeId)
    );
    const spacing = Math.min(16, (length * 0.6) / Math.max(1, endpoints.length - 1));
    endpoints.forEach((endpoint, index) => {
      const offset = (index - (endpoints.length - 1) / 2) * spacing;
      endpoint.point = {
        x: endpoint.origin.x + (horizontal ? offset : 0),
        y: endpoint.origin.y + (horizontal ? 0 : offset),
      };
    });
  }
}
function clipStraight(endpoint: Anchor, other: CanvasPoint): CanvasPoint {
  if (!endpoint.card) return endpoint.point;
  const card = endpoint.card;
  const cx = card.x + card.width / 2,
    cy = card.y + card.height / 2;
  const dx = other.x - cx,
    dy = other.y - cy;
  if (!dx && !dy) return endpoint.point;
  const ratio = 1 / Math.max(Math.abs(dx) / (card.width / 2), Math.abs(dy) / (card.height / 2));
  return { x: cx + dx * ratio, y: cy + dy * ratio };
}
function midpoint(points: readonly CanvasPoint[]): CanvasPoint {
  let total = 0;
  const distances = points.slice(1).map((point, i) => {
    const distance = Math.hypot(point.x - points[i].x, point.y - points[i].y);
    total += distance;
    return distance;
  });
  let remaining = total / 2;
  for (let i = 0; i < distances.length; i++) {
    if (remaining <= distances[i]) {
      const ratio = distances[i] ? remaining / distances[i] : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
        y: points[i].y + (points[i + 1].y - points[i].y) * ratio,
      };
    }
    remaining -= distances[i];
  }
  return points[0];
}
function geometry(entry: EdgeAnchors, zoom: number): CanvasEdgeGeometry {
  const { edge } = entry;
  let from = entry.from.point,
    to = entry.to.point;
  let points: readonly CanvasPoint[];
  if (edge.lineStyle === 'straight') {
    from = clipStraight(
      entry.from,
      entry.to.card
        ? {
            x: entry.to.card.x + entry.to.card.width / 2,
            y: entry.to.card.y + entry.to.card.height / 2,
          }
        : to
    );
    to = clipStraight(
      entry.to,
      entry.from.card
        ? {
            x: entry.from.card.x + entry.from.card.width / 2,
            y: entry.from.card.y + entry.from.card.height / 2,
          }
        : from
    );
    points = [from, to];
  } else if (zoom < 0.15) points = [from, to];
  else {
    const dx = to.x - from.x,
      dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const direction = distance ? { x: dx / distance, y: dy / distance } : { x: 1, y: 0 };
    const fromNormal = entry.from.side ? normals[entry.from.side] : direction;
    const toNormal = entry.to.side ? normals[entry.to.side] : { x: -direction.x, y: -direction.y };
    const fromControl = Math.max(24, Math.min(160, (dx * fromNormal.x + dy * fromNormal.y) / 2));
    const toControl = Math.max(24, Math.min(160, (-dx * toNormal.x - dy * toNormal.y) / 2));
    const c1 = { x: from.x + fromNormal.x * fromControl, y: from.y + fromNormal.y * fromControl };
    const c2 = { x: to.x + toNormal.x * toControl, y: to.y + toNormal.y * toControl };
    points = flattenCanvasCubic([from, c1, c2, to], zoom);
  }
  return {
    from,
    to,
    midpoint: midpoint(points),
    points,
    fromSide: entry.from.side,
    toSide: entry.to.side,
  };
}
/** 单线纯几何；批量场景还要通过 layoutCanvasEdges 做同侧排开。 */
export function resolveCanvasEdgeGeometry(
  edge: CanvasEdge,
  cards: ReadonlyMap<string, CanvasCard>,
  zoom = 1
): CanvasEdgeGeometry {
  return geometry(anchors(edge, cards), zoom);
}
export function layoutCanvasEdges(
  edges: readonly CanvasEdge[],
  cards: ReadonlyMap<string, CanvasCard>,
  zoom: number,
  previous: ReadonlyMap<CanvasEdgeId, CanvasEdgeGeometry> = new Map()
): ReadonlyMap<CanvasEdgeId, CanvasEdgeGeometry> {
  const entries = edges.map(edge => anchors(edge, cards, previous.get(edge.id)));
  spread(groupAnchors(entries).values());
  return new Map(entries.map(entry => [entry.edge.id, geometry(entry, zoom)]));
}
/** 同一拓扑内的局部位置投影；只重算关联端点及同侧排开的邻线，保留其他曲线与GPU资源。 */
export function createCanvasEdgeLayout(
  edges: readonly CanvasEdge[],
  cards: ReadonlyMap<string, CanvasCard>,
  zoom: number,
  previous: ReadonlyMap<CanvasEdgeId, CanvasEdgeGeometry> = new Map()
) {
  const entries = new Map(
    edges.map(edge => [edge.id, anchors(edge, cards, previous.get(edge.id))])
  );
  const groups = groupAnchors(entries.values());
  spread(groups.values());
  const geometries = new Map(
    [...entries.values()].map(entry => [entry.edge.id, geometry(entry, zoom)])
  );
  const byCard = new Map<string, Set<CanvasEdgeId>>();
  for (const edge of edges)
    for (const endpoint of [edge.from, edge.to])
      if (endpoint.kind === 'card') {
        const related = byCard.get(endpoint.cardId) ?? new Set<CanvasEdgeId>();
        related.add(edge.id);
        byCard.set(endpoint.cardId, related);
      }
  return {
    read: (): ReadonlyMap<CanvasEdgeId, CanvasEdgeGeometry> => geometries,
    update(
      nextCards: ReadonlyMap<string, CanvasCard>,
      cardIds: readonly string[],
      nextZoom: number
    ): readonly CanvasEdgeId[] {
      const changed = new Set<CanvasEdgeId>(),
        touched = new Set<string>();
      for (const id of cardIds) for (const edgeId of byCard.get(id) ?? []) changed.add(edgeId);
      for (const id of changed) {
        const previous = entries.get(id);
        if (!previous) throw new Error('canvas_edge_layout_entry_missing');
        for (const endpoint of [previous.from, previous.to])
          removeAnchorFromGroup(endpoint, groups, touched);
        const next = anchors(previous.edge, nextCards, geometries.get(id));
        entries.set(id, next);
        for (const endpoint of [next.from, next.to])
          registerAnchorInGroup(endpoint, groups, touched);
      }
      const touchedGroups = [...touched].flatMap(key => {
        const group = groups.get(key);
        return group ? [group] : [];
      });
      spread(touchedGroups);
      for (const group of touchedGroups) for (const endpoint of group) changed.add(endpoint.edgeId);
      for (const id of changed) {
        const entry = entries.get(id);
        if (!entry) throw new Error('canvas_edge_layout_entry_missing');
        geometries.set(id, geometry(entry, nextZoom));
      }
      return [...changed];
    },
  };
}
export function canvasEdgePoints(
  edge: CanvasEdge,
  cards: ReadonlyMap<string, CanvasCard>,
  zoom: number
): readonly CanvasPoint[] {
  return resolveCanvasEdgeGeometry(edge, cards, zoom).points;
}
