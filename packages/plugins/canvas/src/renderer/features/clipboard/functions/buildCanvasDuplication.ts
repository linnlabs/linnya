import type { CanvasCard, CanvasCardId, CanvasCommand, CanvasElement } from '@plugin/canvas/shared';

/** 仅复制选中的卡及两端都在子图内的线；外部连线不被拖进新子图。 */
export function buildCanvasDuplication(elements: readonly CanvasElement[], ids: readonly CanvasCardId[], dx: number, dy: number) {
  const cards = elements.filter((element): element is CanvasCard => element.type !== 'edge' && ids.includes(element.id));
  const refs = new Map(cards.map((card, index) => [card.id, `$copy${index}`]));
  const operations: CanvasCommand[] = cards.map(card => {
    const placement = { ref: refs.get(card.id), x: card.x + dx, y: card.y + dy, width: card.width, height: card.height, color: card.color };
    if (card.type === 'text') return { ...placement, op: 'addText', content: card.data.content };
    if (card.type === 'image') return { ...placement, op: 'addImage', data: card.data };
    return { ...placement, op: 'addDocument', data: card.data };
  });
  const edges = elements.filter(element => element.type === 'edge' && element.from.kind === 'card' && element.to.kind === 'card' && refs.has(element.from.cardId) && refs.has(element.to.cardId));
  let edgeIndex = 0;
  for (const element of edges) {
    if (element.type !== 'edge' || element.from.kind !== 'card' || element.to.kind !== 'card') continue;
    const from = refs.get(element.from.cardId), to = refs.get(element.to.cardId);
    if (from && to) operations.push({ op: 'connect', ref: `$edge${edgeIndex++}`, from, to, label: element.label, direction: element.direction, lineStyle: element.lineStyle, linePattern: element.linePattern });
  }
  if (operations.length > 500) throw new Error('本次复制超过500项，请分批选择');
  return { operations, refs, cards, edges };
}
