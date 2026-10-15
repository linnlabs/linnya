import type { SlideNavigationKey } from '../definitions/deckNavigatorTypes';

const NAVIGATION_KEYS: ReadonlySet<string> = new Set<SlideNavigationKey>([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End',
]);

export function isSlideNavigationKey(key: string): key is SlideNavigationKey {
  return NAVIGATION_KEYS.has(key);
}

/**
 * 页面条是一维列表（columns = 1 时上下键与左右键等价）；平铺视图上下键跨一整行。
 * 不循环到另一端：首行再向上保持不动，向下没有正下方页面时落到下一行末页。
 */
export function resolveSlideNavigationIndex(input: {
  readonly key: SlideNavigationKey;
  readonly currentIndex: number;
  readonly slideCount: number;
  readonly columns: number;
}): number {
  const lastIndex = input.slideCount - 1;
  if (lastIndex < 0) return 0;
  const current = Math.min(Math.max(input.currentIndex, 0), lastIndex);
  const rowStep = Math.max(1, input.columns);
  switch (input.key) {
    case 'ArrowLeft':
      return Math.max(current - 1, 0);
    case 'ArrowRight':
      return Math.min(current + 1, lastIndex);
    case 'ArrowUp':
      return current - rowStep >= 0 ? current - rowStep : current;
    case 'ArrowDown':
      if (current + rowStep <= lastIndex) return current + rowStep;
      return Math.floor(current / rowStep) < Math.floor(lastIndex / rowStep) ? lastIndex : current;
    case 'Home':
      return 0;
    case 'End':
      return lastIndex;
  }
}
