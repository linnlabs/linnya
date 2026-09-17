import type { ElementPropertyRect, ElementPropertySize } from '../definitions/elementPropertyToolbar';

/** 只在当前 Slides pane 内放置；窄 pane 无法并排时允许盖住色板，保留取消/返回入口。 */
export function resolveCustomColorSubmenuPosition(
  menu: ElementPropertyRect,
  row: ElementPropertyRect,
  surface: ElementPropertySize,
  viewport: ElementPropertySize,
): { readonly left: number; readonly top: number } {
  const right = menu.left + menu.width + 4;
  const left = menu.left - surface.width - 4;
  const horizontal = right + surface.width <= viewport.width - 8 ? right : left;
  const vertical = row.top + surface.height <= viewport.height - 8 ? row.top : row.top + row.height - surface.height;
  return {
    left: Math.max(8, Math.min(horizontal, viewport.width - surface.width - 8)),
    top: Math.max(8, Math.min(vertical, viewport.height - surface.height - 8)),
  };
}
