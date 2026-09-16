import type { FloatingToolbarPosition } from '@linnya/renderer-ui';
import type { ElementPropertyAnchor, ElementPropertyRect, ElementPropertySize } from '../definitions/elementPropertyToolbar';

const EDGE_GAP = 8;

export function resolveElementPropertyToolbarPosition(
  anchor: ElementPropertyAnchor,
  surface: ElementPropertySize,
  hasHierarchy: boolean,
): FloatingToolbarPosition | null {
  const { selection, viewport } = anchor;
  const right = selection.left + selection.width;
  const bottom = selection.top + selection.height;
  if (right <= 0 || bottom <= 0 || selection.left >= viewport.width || selection.top >= viewport.height) return null;
  // 以可见部分居中；超大 Frame 或移出画布的子元素不会把工具条带出当前 pane。
  const center = (Math.max(0, selection.left) + Math.min(viewport.width, right)) / 2;
  const above = selection.top - surface.height - (hasHierarchy ? 24 : 12);
  const below = bottom + 12;
  const top = above >= EDGE_GAP ? above
    : below + surface.height <= viewport.height - EDGE_GAP ? below
      : hasHierarchy ? Math.max(EDGE_GAP, selection.top + 24) : EDGE_GAP;
  return {
    left: constrain(center - surface.width / 2, surface.width, viewport.width),
    top: constrain(top, surface.height, viewport.height),
  };
}

export function resolveElementPropertyPopoverPosition(
  toolbar: ElementPropertyRect,
  surface: ElementPropertySize,
  viewport: ElementPropertySize,
): FloatingToolbarPosition & { readonly maxHeight: number } {
  const below = toolbar.top + toolbar.height + EDGE_GAP;
  const belowSpace = Math.max(0, viewport.height - below - EDGE_GAP);
  const aboveSpace = Math.max(0, toolbar.top - EDGE_GAP * 2);
  const placeBelow = surface.height <= belowSpace || belowSpace >= aboveSpace;
  const maxHeight = placeBelow ? belowSpace : aboveSpace;
  // 空间不足时面板内部滚动，不能盖住自己的触发按钮导致无法切换／关闭。
  return {
    left: constrain(toolbar.left, surface.width, viewport.width),
    top: placeBelow ? below : toolbar.top - EDGE_GAP - Math.min(surface.height, maxHeight),
    maxHeight,
  };
}

function constrain(position: number, size: number, viewport: number): number {
  return Math.max(EDGE_GAP, Math.min(position, viewport - EDGE_GAP - size));
}
