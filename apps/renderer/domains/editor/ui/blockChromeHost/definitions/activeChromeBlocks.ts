/**
 * activeChromeBlocks.ts
 *
 * BlockChromeHost 的候选块契约。
 *
 * 中文说明：这里刻意只描述“哪些 block 需要 chrome”以及来源，不包含
 * editor / node / DOM 等运行时对象，避免 Stage 3 一开始就把 Host 绑回
 * Tiptap NodeView props。
 */

export const ACTIVE_CHROME_SOURCE_ORDER = [
  'hovered',
  'selected',
  'focused',
  'menu-open',
  'dragging',
  'annotation',
  'revision-toolbar',
  'history-mode',
  'keep-alive',
] as const;

export type ActiveChromeSource = (typeof ACTIVE_CHROME_SOURCE_ORDER)[number];

export interface ActiveChromeSourceSnapshot {
  hoveredBlockId?: string | null;
  selectedBlockId?: string | null;
  focusedBlockId?: string | null;
  menuOpenBlockId?: string | null;
  draggingBlockId?: string | null;
  annotationActiveBlockIds?: readonly (string | null | undefined)[];
  revisionToolbarBlockIds?: readonly (string | null | undefined)[];
  historyModeBlockIds?: readonly (string | null | undefined)[];
  keepAlivePinnedBlockIds?: readonly (string | null | undefined)[];
}

export interface ActiveChromeBlock {
  blockId: string;
  sources: ActiveChromeSource[];
}
