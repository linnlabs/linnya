import { generateKeyBetween } from 'fractional-indexing';
import type { CanvasElement } from '../../../../shared';

type Card = Exclude<CanvasElement, { type: 'edge' }>;
type Edge = Extract<CanvasElement, { type: 'edge' }>;

function validateEdge(edge: Edge, cards: ReadonlyMap<string, Card>, edges: Set<string>) {
  for (const endpoint of [edge.from, edge.to]) {
    if (endpoint.kind === 'card' && !cards.has(endpoint.cardId)) throw new Error('连线端点不存在');
  }
  if (edge.from.kind !== 'card' || edge.to.kind !== 'card') return;
  if (edge.from.cardId === edge.to.cardId) throw new Error('不支持自连线');
  const key = `${edge.from.cardId}:${edge.to.cardId}`;
  if (edges.has(key)) throw new Error('同方向连线重复');
  edges.add(key);
}

function validateGrouping(card: Card, cards: ReadonlyMap<string, Card>, completed: Set<string>) {
  const chain = new Set<string>();
  let current: Card | undefined = card;
  while (current && !completed.has(current.id)) {
    if (chain.has(current.id)) throw new Error('分组不能成环');
    chain.add(current.id);
    if (current.parentId && !cards.has(current.parentId)) throw new Error('分组父卡不存在');
    current = current.parentId ? cards.get(current.parentId) : undefined;
  }
  for (const id of chain) completed.add(id);
}

export function validateCanvasGraph(elements: readonly CanvasElement[]): void {
  const cards = new Map(elements.flatMap(element => element.type === 'edge' ? [] : [[element.id, element] as const]));
  const edges = new Set<string>();
  const completed = new Set<string>();
  for (const element of elements) {
    // 让锁定版本的库验证格式；非法排序键必须拒绝，不重新编号掩盖坏数据。
    generateKeyBetween(element.order, null);
    if (element.type === 'edge') validateEdge(element, cards, edges);
    else validateGrouping(element, cards, completed);
  }
}
