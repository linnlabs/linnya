import type { CanvasMenuAnchor } from '../definitions/canvasMenu';

/** 菜单与锚点、视口边缘的间距（px）。 */
const GAP = 4,
  EDGE = 8;

/**
 * 菜单默认在锚点下方展开；下方放不下而上方放得下时翻到上方，两边都放不下时贴视口底边。
 * 横向按 align 对齐锚点，再整体收进视口。
 */
export function placeCanvasMenu(
  anchor: CanvasMenuAnchor,
  size: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number }
): { left: number; top: number } {
  const below = anchor.bottom + GAP,
    above = anchor.top - GAP - size.height;
  const top =
    below + size.height <= viewport.height - EDGE
      ? below
      : above >= EDGE
        ? above
        : Math.max(EDGE, viewport.height - EDGE - size.height);
  const preferred = anchor.align === 'end' ? anchor.right - size.width : anchor.left;
  const left = Math.min(Math.max(EDGE, preferred), viewport.width - EDGE - size.width);
  return { left: Math.max(EDGE, left), top };
}
