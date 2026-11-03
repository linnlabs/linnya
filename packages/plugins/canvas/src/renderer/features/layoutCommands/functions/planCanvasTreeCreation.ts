import type { CanvasCard, CanvasCardId, CanvasElement } from '@plugin/canvas/shared';
import type { CanvasTreeCreationPlan } from '../definitions/canvasLayoutCommands';
function componentIds(elements: readonly CanvasElement[], id: CanvasCardId): CanvasCardId[] {
  const neighbors = new Map<CanvasCardId, CanvasCardId[]>();
  for (const element of elements) if (element.type === 'edge' && element.from.kind === 'card' && element.to.kind === 'card') {
    const from = neighbors.get(element.from.cardId) ?? [], to = neighbors.get(element.to.cardId) ?? [];
    from.push(element.to.cardId); to.push(element.from.cardId); neighbors.set(element.from.cardId, from); neighbors.set(element.to.cardId, to);
  }
  const visited = new Set<CanvasCardId>([id]), queue = [id];
  for (let index = 0; index < queue.length; index++) for (const neighbor of neighbors.get(queue[index]) ?? []) if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
  return [...visited];
}
/** 树父子按from→to定义，与箭头画法及预留分组parentId无关。多父不能任取一条。 */
export function planCanvasTreeCreation(elements: readonly CanvasElement[], selected: readonly CanvasCardId[], kind: 'child' | 'sibling', direction: 'right' | 'down'): CanvasTreeCreationPlan {
  if (selected.length !== 1) throw new Error('树状键盘操作需要选中一张卡');
  const card = elements.find((element): element is CanvasCard => element.id === selected[0] && element.type !== 'edge');
  if (!card) throw new Error('所选卡已被删除'); if (card.locked) throw new Error('请先解锁所选卡');
  const parents = new Set(elements.flatMap(element => element.type === 'edge' && element.to.kind === 'card' && element.to.cardId === card.id && element.from.kind === 'card' ? [element.from.cardId] : []));
  if (kind === 'sibling' && parents.size > 1) throw new Error('这张卡有多个上级，请先选择一个上级，再用 Tab 创建子卡');
  const parent = kind === 'child' ? card.id : [...parents][0] ?? null;
  const point = kind === 'child' ? direction === 'right' ? { x: card.x + card.width + 80, y: card.y + card.height / 2 } : { x: card.x + card.width / 2, y: card.y + card.height + 80 }
    : direction === 'right' ? { x: card.x, y: card.y + card.height + 80 } : { x: card.x + card.width + 80, y: card.y };
  return { point, from: parent ? { kind: 'card', cardId: parent, side: direction === 'right' ? 'right' : 'bottom' } : null,
    options: { algorithm: 'tree', direction, elementIds: [...componentIds(elements, card.id), '$created'] } };
}
