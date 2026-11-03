import { generateKeyBetween } from 'fractional-indexing';
import { canvasBounds, type CanvasCard, type CanvasCardId, type CanvasCommand, type CanvasElement } from '@plugin/canvas/shared';

export function buildLockCommands(elements: readonly CanvasElement[], ids: readonly CanvasCardId[]): CanvasCommand[] {
  const selected = elements.filter((element): element is CanvasCard => element.type !== 'edge' && ids.includes(element.id));
  const locked = !selected.every(card => card.locked);
  return selected.map(card => ({ op: 'update', id: card.id, baseRevision: card.revision, patch: { locked } }));
}
export function buildLayerCommands(elements: readonly CanvasElement[], ids: readonly CanvasCardId[], direction: 'front' | 'back'): CanvasCommand[] {
  const remaining = elements.filter(element => !ids.some(id => id === element.id)).map(element => element.order).sort();
  const cards = elements.filter((element): element is CanvasCard => element.type !== 'edge' && ids.includes(element.id) && !element.locked).sort((a, b) => a.order.localeCompare(b.order));
  let lower = direction === 'front' ? remaining[remaining.length - 1] ?? null : null;
  const upper = direction === 'front' ? null : remaining[0] ?? null;
  return cards.map(card => { const order = generateKeyBetween(lower, upper); lower = order; return { op: 'update', id: card.id, baseRevision: card.revision, patch: { order } }; });
}
export function buildAlignCommands(elements: readonly CanvasElement[], ids: readonly CanvasCardId[], mode: 'left' | 'top' | 'grid'): CanvasCommand[] {
  const cards = elements.filter((element): element is CanvasCard => element.type !== 'edge' && ids.includes(element.id) && !element.locked);
  const bounds = canvasBounds(cards);
  if (!bounds) return [];
  const columns = Math.ceil(Math.sqrt(cards.length));
  const width = Math.max(...cards.map(card => card.width)) + 32, height = Math.max(...cards.map(card => card.height)) + 32;
  return cards.map((card, index) => ({ op: 'update', id: card.id, baseRevision: card.revision, patch: mode === 'grid'
    ? { x: bounds.x + index % columns * width, y: bounds.y + Math.floor(index / columns) * height }
    : mode === 'left' ? { x: bounds.x } : { y: bounds.y } }));
}
