import {
  canvasBounds,
  orderCanvasCardsForReading,
  readCanvasCardConnections,
  searchCanvasElements,
  type CanvasCard,
  type CanvasSnapshot,
} from '../../../../shared';
import {
  projectCanvasCardBody,
  projectCanvasDocument,
  type CanvasProjectionContext,
} from '../../canvasProjection';
import type { CanvasQuery } from '../definitions/canvasQuery';
const regions = ['左上', '上方', '右上', '左侧', '正中', '右侧', '左下', '下方', '右下'];
function regionFor(card: CanvasCard, bounds: NonNullable<ReturnType<typeof canvasBounds>>): string {
  const column = Math.min(
    2,
    Math.max(0, Math.floor(((card.x + card.width / 2 - bounds.x) / bounds.width) * 3))
  );
  const row = Math.min(
    2,
    Math.max(0, Math.floor(((card.y + card.height / 2 - bounds.y) / bounds.height) * 3))
  );
  return regions[row * 3 + column];
}
function neighbors(snapshot: CanvasSnapshot, id: string, depth: number): ReadonlySet<string> {
  const result = new Set([id]);
  let frontier = new Set([id]);
  for (let level = 0; level < depth; level++) {
    const next = new Set<string>();
    for (const edge of snapshot.elements) {
      if (edge.type !== 'edge' || edge.from.kind !== 'card' || edge.to.kind !== 'card') continue;
      if (frontier.has(edge.from.cardId) && !result.has(edge.to.cardId)) next.add(edge.to.cardId);
      if (frontier.has(edge.to.cardId) && !result.has(edge.from.cardId)) next.add(edge.from.cardId);
    }
    for (const key of next) result.add(key);
    frontier = next;
  }
  return result;
}
export function queryCanvas(
  snapshot: CanvasSnapshot,
  context: CanvasProjectionContext,
  query: CanvasQuery
) {
  if (query.kind === 'read')
    return { sequence: snapshot.sequence, text: projectCanvasDocument(snapshot, context) };
  if (query.kind === 'find') {
    const matches = searchCanvasElements(snapshot.elements, query.value, context);
    return { sequence: snapshot.sequence, total: matches.length, matches: matches.slice(0, 100) };
  }
  const cards = snapshot.elements.filter(
    (element): element is CanvasCard => element.type !== 'edge'
  );
  const bounds = canvasBounds(cards);
  if (query.kind === 'region' && !regions.includes(query.value))
    throw new Error(`invalid_region: 方位是 ${regions.join('、')}`);
  const wanted = query.kind === 'neighbors' ? neighbors(snapshot, query.value, query.depth) : null;
  if (query.kind !== 'region' && !snapshot.elements.some(element => element.id === query.value))
    throw new Error('canvas_element_not_found');
  const selected = cards.filter(card =>
    query.kind === 'region'
      ? bounds && regionFor(card, bounds) === query.value
      : wanted
        ? wanted.has(card.id)
        : card.id === query.value
  );
  const elements = orderCanvasCardsForReading(
    selected,
    readCanvasCardConnections(snapshot.elements)
  ).map(card => ({
    id: card.id,
    type: card.type,
    revision: card.revision,
    color: card.color,
    locked: card.locked,
    text: projectCanvasCardBody(card, context),
  }));
  const selectedIds = new Set<string>(selected.map(card => card.id));
  const edges = snapshot.elements.filter(
    element =>
      element.type === 'edge' &&
      (query.kind === 'show'
        ? element.id === query.value
        : element.from.kind === 'card' &&
          element.to.kind === 'card' &&
          selectedIds.has(element.from.cardId) &&
          selectedIds.has(element.to.cardId))
  );
  return {
    sequence: snapshot.sequence,
    elements,
    edges: edges.map(edge =>
      edge.type === 'edge'
        ? {
            id: edge.id,
            revision: edge.revision,
            label: edge.label,
            from: edge.from.kind === 'card' ? edge.from.cardId : '悬空',
            to: edge.to.kind === 'card' ? edge.to.cardId : '悬空',
            direction: edge.direction,
          }
        : null
    ),
  };
}
