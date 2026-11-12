import { generateKeyBetween } from 'fractional-indexing';
import type { CanvasElement } from '../../../../shared';
import { CanvasCommitFailure } from '../definitions/canvasCommitFailure';

type Card = Exclude<CanvasElement, { type: 'edge' }>;
type Edge = Extract<CanvasElement, { type: 'edge' }>;

function validateEdge(edge: Edge, cards: ReadonlyMap<string, Card>, edges: Set<string>) {
  for (const endpoint of [edge.from, edge.to]) {
    if (endpoint.kind === 'card' && !cards.has(endpoint.cardId))
      throw new CanvasCommitFailure('canvas_endpoint_missing');
  }
  if (edge.from.kind !== 'card' || edge.to.kind !== 'card') return;
  if (edge.from.cardId === edge.to.cardId) throw new CanvasCommitFailure('canvas_self_connection');
  const key = `${edge.from.cardId}:${edge.to.cardId}`;
  if (edges.has(key)) throw new CanvasCommitFailure('canvas_duplicate_connection');
  edges.add(key);
}

/** 分区只有一层：成员的 parentId 必须指向分区，分区自身不属于任何分区。 */
function validateGrouping(card: Card, cards: ReadonlyMap<string, Card>) {
  if (!card.parentId) return;
  if (card.parentId === card.id) throw new CanvasCommitFailure('canvas_group_cycle');
  const parent = cards.get(card.parentId);
  if (!parent) throw new CanvasCommitFailure('canvas_group_parent_missing');
  if (parent.type !== 'section' || card.type === 'section')
    throw new CanvasCommitFailure('canvas_section_parent_invalid');
}

export function validateCanvasGraph(elements: readonly CanvasElement[]): void {
  const cards = new Map(
    elements.flatMap(element => (element.type === 'edge' ? [] : [[element.id, element] as const]))
  );
  const edges = new Set<string>();
  for (const element of elements) {
    // 让锁定版本的库验证格式；非法排序键必须拒绝，不重新编号掩盖坏数据。
    generateKeyBetween(element.order, null);
    if (element.type === 'edge') validateEdge(element, cards, edges);
    else validateGrouping(element, cards);
  }
}
