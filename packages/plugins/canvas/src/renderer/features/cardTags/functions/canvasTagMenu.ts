import type { CustomSelectOption } from '@linnya/renderer-ui';
import type { CanvasCard, CanvasTagName, CanvasTagNames } from '@plugin/canvas/shared';
import { canvasText } from '../../localization';
import { canvasCardsCarryTag, canvasCardsHaveStatus } from './buildCanvasTagCommands';

export type CanvasTagMenuChoice =
  | { readonly kind: 'tag'; readonly id: string }
  | { readonly kind: 'status'; readonly id: string | null };

const NO_STATUS = 'status:';

/** 菜单值：`tag:<标签ID>` 挂上或取下，`status:<标签ID>` 设为状态，`status:` 清除状态。 */
export function readCanvasTagMenuChoice(value: string): CanvasTagMenuChoice | null {
  if (value.startsWith('tag:') && value.length > 4) return { kind: 'tag', id: value.slice(4) };
  if (value === NO_STATUS) return { kind: 'status', id: null };
  if (value.startsWith('status:')) return { kind: 'status', id: value.slice(7) };
  return null;
}

/**
 * 右键菜单的“标签”“状态”两个子菜单，列工作区已有标签；工作区还没有标签时不出现。
 * 新建、改名、合并仍在标签管理或由 Agent 用 linnya schema 完成，画布不新建标签。
 */
export function canvasTagMenuGroups(input: {
  readonly catalog: readonly CanvasTagName[];
  readonly cards: readonly CanvasCard[];
  readonly names: CanvasTagNames;
}): readonly CustomSelectOption<string>[] {
  const { catalog, cards, names } = input;
  if (!catalog.length || !cards.length) return [];
  const anyStatus = cards.some(card => card.status && names.has(card.status));
  return [
    {
      text: canvasText('canvas.tags.menu'),
      children: catalog.map(tag => ({
        value: `tag:${tag.id}`,
        text: `#${tag.name}`,
        selected: canvasCardsCarryTag(cards, names, tag.id),
      })),
    },
    {
      text: canvasText('canvas.tags.status'),
      children: [
        ...catalog.map(tag => ({
          value: `status:${tag.id}`,
          text: tag.name,
          selected: canvasCardsHaveStatus(cards, names, tag.id),
        })),
        ...(anyStatus
          ? [
              { isSeparator: true },
              { value: NO_STATUS, text: canvasText('canvas.tags.clearStatus') },
            ]
          : []),
      ],
    },
  ];
}
