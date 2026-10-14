import type {
  SubmenuGeometryInput,
  SubmenuRect,
  SubmenuViewport,
} from '../definitions/submenuGeometry';

const VIEWPORT_PADDING = 8;
const SUBMENU_GAP = 4;

export function submenuViewportSize(viewport: SubmenuViewport) {
  return {
    width: Math.max(0, viewport.width - VIEWPORT_PADDING * 2),
    height: Math.max(0, viewport.height - VIEWPORT_PADDING * 2),
  };
}

export function isSubmenuAnchorVisible(
  parent: SubmenuRect,
  menu: SubmenuRect,
  viewport: SubmenuViewport
) {
  return (
    parent.bottom > Math.max(menu.top, 0) &&
    parent.top < Math.min(menu.bottom, viewport.height) &&
    parent.right > Math.max(menu.left, 0) &&
    parent.left < Math.min(menu.right, viewport.width)
  );
}

/** 尺寸先由普通列表的滚动视口限制；定位只使用限制后的真实 border-box。 */
export function resolveSubmenuPosition({ parent, menu, panel, viewport }: SubmenuGeometryInput) {
  const bottom = viewport.height - VIEWPORT_PADDING;
  const maxTop = Math.max(VIEWPORT_PADDING, bottom - panel.height);
  let top: number;
  if (parent.top >= VIEWPORT_PADDING && parent.top + panel.height <= bottom) {
    top = parent.top;
  } else if (parent.bottom - panel.height >= VIEWPORT_PADDING && parent.bottom <= bottom) {
    top = parent.bottom - panel.height;
  } else {
    top = Math.min(
      Math.max(parent.top + (parent.height - panel.height) / 2, VIEWPORT_PADDING),
      maxTop
    );
  }

  // 根菜单越界时贴近真实父项；两侧都放不下时允许重叠父层，优先保证列表可达。
  const menuWithinViewport =
    menu.left >= VIEWPORT_PADDING && menu.right <= viewport.width - VIEWPORT_PADDING;
  const anchor = menuWithinViewport ? menu : parent;
  const rightAligned = anchor.right + SUBMENU_GAP;
  const leftAligned = anchor.left - SUBMENU_GAP - panel.width;
  const maxLeft = Math.max(VIEWPORT_PADDING, viewport.width - VIEWPORT_PADDING - panel.width);
  const left =
    rightAligned <= maxLeft
      ? rightAligned
      : leftAligned >= VIEWPORT_PADDING
        ? Math.min(leftAligned, maxLeft)
        : Math.min(Math.max(rightAligned, VIEWPORT_PADDING), maxLeft);

  return { top, left };
}
