import type { CanvasCard, CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasDocumentDetailCard } from '../definitions/documentDetail';

/** 只把单张近景文档变为活 DOM；框选和编辑正文不额外挂载第二份详情。 */
export function canvasDocumentDetailTarget(input: {
  readonly cards: readonly CanvasCard[]; readonly zoom: number; readonly editing: boolean;
  readonly projectId: string | null; readonly dismissed: CanvasCardId | null;
}): CanvasDocumentDetailCard | null {
  if (!input.projectId || input.editing || input.zoom < 0.75 || input.cards.length !== 1) return null;
  const card = input.cards[0];
  return card?.type === 'document' && card.id !== input.dismissed ? card : null;
}
