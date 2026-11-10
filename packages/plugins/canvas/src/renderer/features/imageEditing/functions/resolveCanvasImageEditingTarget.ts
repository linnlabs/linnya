import type { CanvasSnapshot } from '@plugin/canvas/shared';
import type { CanvasImageCard } from '../definitions/canvasImageEditing';
import { canvasText } from '../../localization';
export function resolveCanvasImageEditingTarget(
  snapshot: CanvasSnapshot,
  id: string
): CanvasImageCard {
  const card = snapshot.elements.find(element => element.id === id);
  if (!card || card.type !== 'image') throw new Error(canvasText('canvas.error.imageCardGone'));
  if (card.locked) throw new Error(canvasText('canvas.error.imageCardLocked'));
  return card;
}
