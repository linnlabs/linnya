import type { CanvasDuplicationInput } from '../definitions/canvasDuplication';
import { duplicateCanvasDocumentReferences } from './duplicateCanvasDocumentReferences';
import type { CanvasCard, CanvasCardId, CanvasCommand } from '@plugin/canvas/shared';

/** 仅复制选中的卡及两端都在子图内的线；外部连线不被拖进新子图。 */
export function buildCanvasDuplication({ elements, ids, dx, dy, allocateReferenceId }: CanvasDuplicationInput) {
  const selected = elements.filter((element): element is CanvasCard => element.type !== 'edge' && ids.includes(element.id));
  const byId = new Map(selected.map(card => [card.id, card]));
  const cards: CanvasCard[] = [], visited = new Set<CanvasCardId>();
  const visit = (card: CanvasCard) => {
    if (visited.has(card.id)) return;
    visited.add(card.id);
    const parent = card.parentId ? byId.get(card.parentId) : undefined;
    if (parent) visit(parent);
    cards.push(card);
  };
  selected.forEach(visit);
  const refs = new Map(cards.map((card, index) => [card.id, `$copy${index}`]));
  const operations: CanvasCommand[] = cards.map(card => {
    const placement = { ref: refs.get(card.id), x: card.x + dx, y: card.y + dy, width: card.width, height: card.height, color: card.color, locked: card.locked, ...(card.parentId && refs.has(card.parentId) ? { parentId: refs.get(card.parentId) } : {}) };
    if (card.type === 'text') return { ...placement, op: 'addText', content: duplicateCanvasDocumentReferences(card.data.content, allocateReferenceId), heightMode: card.data.heightMode };
    if (card.type === 'image') return { ...placement, op: 'addImage', data: card.data };
    return { ...placement, op: 'addDocument', data: card.data };
  });
  const edges = elements.filter(element => element.type === 'edge' && element.from.kind === 'card' && element.to.kind === 'card' && refs.has(element.from.cardId) && refs.has(element.to.cardId));
  let edgeIndex = 0;
  for (const element of edges) {
    if (element.type !== 'edge' || element.from.kind !== 'card' || element.to.kind !== 'card') continue;
    const from = refs.get(element.from.cardId), to = refs.get(element.to.cardId);
    if (from && to) operations.push({ op: 'connect', ref: `$edge${edgeIndex++}`, from, to, label: element.label, direction: element.direction, lineStyle: element.lineStyle, linePattern: element.linePattern, color: element.color, locked: element.locked, fromSide: element.from.side, toSide: element.to.side });
  }
  return { operations, refs, cards, edges };
}
