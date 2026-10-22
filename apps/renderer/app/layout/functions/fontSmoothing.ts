/**
 * 字体抗锯齿（`-webkit-font-smoothing`）的 DOM 应用。
 *
 * 默认开启（antialiased）：文字笔画更纤细。关闭后回到系统默认渲染，文字略粗。
 * 该属性只在 macOS 上有可见差别。样式由 `reset.css` 按这个属性决定：
 * 属性缺失或为 `on` 时开启，只有 `off` 才关闭，所以启动首帧不会闪。
 */
export const FONT_SMOOTHING_ATTRIBUTE = 'data-linnya-font-smoothing';

export type FontSmoothingAttributeValue = 'on' | 'off';

export interface FontSmoothingDomRoot {
  setAttribute(name: string, value: string): void;
}

export function resolveFontSmoothingAttribute(enabled: boolean): FontSmoothingAttributeValue {
  return enabled ? 'on' : 'off';
}

export function applyFontSmoothingToDom(enabled: boolean, root: FontSmoothingDomRoot): void {
  root.setAttribute(FONT_SMOOTHING_ATTRIBUTE, resolveFontSmoothingAttribute(enabled));
}
