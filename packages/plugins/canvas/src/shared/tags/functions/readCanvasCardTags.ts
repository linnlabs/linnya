import type { CanvasCard, CanvasElement } from '../../model/definitions/canvasElement';
import type { CanvasTagName, CanvasTagNames } from '../definitions/canvasTags';

/** 画布里所有卡片存着的标签 ID（含状态角标），去重。 */
export function listCanvasTagIds(elements: readonly CanvasElement[]): string[] {
  const ids = new Set<string>();
  for (const element of elements) {
    if (element.type === 'edge') continue;
    for (const id of element.tags ?? []) ids.add(id);
    if (element.status) ids.add(element.status);
  }
  return [...ids];
}

/**
 * 卡片当前显示的状态与标签：ID 换成当前标签（合并的跟到目标，删除的去掉），按当前身份去重；
 * 与状态相同的标签不再重复列出。
 */
export function readCanvasCardTags(
  card: Pick<CanvasCard, 'tags' | 'status'>,
  names: CanvasTagNames
): { readonly status: CanvasTagName | null; readonly tags: readonly CanvasTagName[] } {
  const status = card.status ? (names.get(card.status) ?? null) : null;
  const seen = new Set(status ? [status.id] : []);
  const tags: CanvasTagName[] = [];
  for (const id of card.tags ?? []) {
    const tag = names.get(id);
    if (!tag || seen.has(tag.id)) continue;
    seen.add(tag.id);
    tags.push(tag);
  }
  return { status, tags };
}

/** 卡片是否带某个标签（按当前身份比较；状态角标也算带着）。 */
export function canvasCardHasTag(
  card: Pick<CanvasCard, 'tags' | 'status'>,
  names: CanvasTagNames,
  tagId: string
): boolean {
  const current = readCanvasCardTags(card, names);
  return current.status?.id === tagId || current.tags.some(tag => tag.id === tagId);
}
