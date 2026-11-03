import type { CanvasElement, CanvasElementId } from '../../../../shared';
import type { CanvasStoredElement } from '../../../features/canvasCommit';

export function canvasHistoryDependenciesValid(element: CanvasElement, rows: ReadonlyMap<CanvasElementId, CanvasStoredElement>): boolean {
  if (element.type === 'edge') {
    if (![element.from, element.to].every(endpoint => endpoint.kind === 'point' || rows.has(endpoint.cardId))) return false;
    if (element.from.kind !== 'card' || element.to.kind !== 'card') return true;
    const fromId = element.from.cardId; const toId = element.to.cardId;
    return fromId !== toId && ![...rows.values()].some(row => row.element.id !== element.id && row.element.type === 'edge' && row.element.from.kind === 'card' && row.element.to.kind === 'card' && row.element.from.cardId === fromId && row.element.to.cardId === toId);
  }
  let parent = element.parentId;
  const visited = new Set<CanvasElementId>([element.id]);
  while (parent) {
    if (visited.has(parent)) return false;
    visited.add(parent);
    const next = rows.get(parent)?.element;
    if (!next || next.type === 'edge') return false;
    parent = next.parentId;
  }
  return true;
}
