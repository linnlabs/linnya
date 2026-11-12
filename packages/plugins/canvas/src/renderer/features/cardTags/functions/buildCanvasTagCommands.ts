import {
  CANVAS_CARD_TAG_LIMIT,
  canvasCardHasTag,
  type CanvasCard,
  type CanvasCardId,
  type CanvasCommand,
  type CanvasElement,
  type CanvasTagNames,
} from '@plugin/canvas/shared';

function editable(elements: readonly CanvasElement[], ids: readonly CanvasCardId[]): CanvasCard[] {
  return elements.filter(
    (element): element is CanvasCard =>
      element.type !== 'edge' && ids.includes(element.id) && !element.locked
  );
}

/** 卡片本身挂着这个标签（不算状态角标）；合并过的旧 ID 按当前身份比较。 */
function carries(card: CanvasCard, names: CanvasTagNames, tagId: string): boolean {
  return (card.tags ?? []).some(id => id === tagId || names.get(id)?.id === tagId);
}

/**
 * 菜单里勾一个标签：选中的卡都已带着就全部取下，否则给还没带的卡挂上（满 12 个的跳过）。
 * 锁定卡不改，与染色一致。
 */
export function buildCanvasTagToggleCommands(input: {
  readonly elements: readonly CanvasElement[];
  readonly ids: readonly CanvasCardId[];
  readonly names: CanvasTagNames;
  readonly tagId: string;
}): CanvasCommand[] {
  const cards = editable(input.elements, input.ids);
  const remove = cards.length > 0 && cards.every(card => carries(card, input.names, input.tagId));
  return cards.flatMap((card): CanvasCommand[] => {
    const current = card.tags ?? [];
    if (remove) {
      const tags = current.filter(
        id => id !== input.tagId && input.names.get(id)?.id !== input.tagId
      );
      return [{ op: 'update', id: card.id, baseRevision: card.revision, patch: { tags } }];
    }
    if (carries(card, input.names, input.tagId) || current.length >= CANVAS_CARD_TAG_LIMIT)
      return [];
    const tags = [...current, input.tagId];
    return [{ op: 'update', id: card.id, baseRevision: card.revision, patch: { tags } }];
  });
}

/** 设定或清除状态角标；已经是这个状态的卡不重复提交。 */
export function buildCanvasStatusCommands(input: {
  readonly elements: readonly CanvasElement[];
  readonly ids: readonly CanvasCardId[];
  readonly names: CanvasTagNames;
  readonly tagId: string | null;
}): CanvasCommand[] {
  return editable(input.elements, input.ids).flatMap((card): CanvasCommand[] => {
    const current = card.status ? (input.names.get(card.status)?.id ?? card.status) : null;
    if (current === input.tagId || (!card.status && input.tagId === null)) return [];
    return [
      { op: 'update', id: card.id, baseRevision: card.revision, patch: { status: input.tagId } },
    ];
  });
}

/** 选中的卡是否都带着这个标签（菜单勾选状态）。 */
export function canvasCardsCarryTag(
  cards: readonly CanvasCard[],
  names: CanvasTagNames,
  tagId: string
): boolean {
  return cards.length > 0 && cards.every(card => carries(card, names, tagId));
}

/** 选中的卡是否都是这个状态。 */
export function canvasCardsHaveStatus(
  cards: readonly CanvasCard[],
  names: CanvasTagNames,
  tagId: string
): boolean {
  return (
    cards.length > 0 && cards.every(card => canvasCardHasTag({ status: card.status }, names, tagId))
  );
}
