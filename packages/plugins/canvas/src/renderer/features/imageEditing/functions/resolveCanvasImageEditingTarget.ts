import type { CanvasSnapshot } from '@plugin/canvas/shared';
import type { CanvasImageCard } from '../definitions/canvasImageEditing';
export function resolveCanvasImageEditingTarget(
  snapshot: CanvasSnapshot,
  id: string
): CanvasImageCard {
  const card = snapshot.elements.find(element => element.id === id);
  if (!card || card.type !== 'image') throw new Error('图片卡片已删除或不可编辑');
  if (card.locked) throw new Error('请先解锁图片卡片');
  return card;
}
