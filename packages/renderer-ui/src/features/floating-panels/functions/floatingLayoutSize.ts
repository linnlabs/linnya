/**
 * 浮层定位时量浮层自身的尺寸。
 *
 * 菜单、面板打开时有一段从按钮处缩放入场的动画（起始 scale 0.96）。打开当帧用 getBoundingClientRect
 * 量到的是缩小后的尺寸，按它算出的位置会贴住甚至压住按钮，动画结束后再被别的刷新纠正，看起来就是“突变”。
 * offsetWidth / offsetHeight 是布局尺寸，不受 transform 影响，打开当帧就能拿到最终大小。
 * 按钮等锚点仍用 getBoundingClientRect：它们不做缩放，且需要视口坐标。
 */
export interface FloatingLayoutSize {
  readonly width: number;
  readonly height: number;
}

/**
 * @deprecated 3.15.0 起贴着锚点弹出的浮层改用 `useAnchoredPosition`，它内部已按布局尺寸量浮层。
 * 保留导出只为兼容现有插件。
 */
export function measureFloatingLayoutSize(element: HTMLElement): FloatingLayoutSize {
  return { width: element.offsetWidth, height: element.offsetHeight };
}
