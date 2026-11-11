import type { VisualColor } from './definitions';

export interface VisualParsedColor {
  readonly rgb: VisualColor;
  readonly alpha: number;
}

/** 计算样式里的颜色有 rgb()/rgba() 与 color(srgb r g b / a) 两种写法（color-mix 的结果是后者）。 */
export function parseVisualColor(value: string): VisualParsedColor | null {
  const legacy = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  if (legacy) {
    return { rgb: [Number(legacy[1]), Number(legacy[2]), Number(legacy[3])], alpha: legacy[4] === undefined ? 1 : Number(legacy[4]) };
  }
  const srgb = value.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/);
  if (!srgb) return null;
  const channel = (index: number) => Math.round(Number(srgb[index]) * 255);
  return { rgb: [channel(1), channel(2), channel(3)], alpha: srgb[4] === undefined ? 1 : Number(srgb[4]) };
}

/** 按浏览器 source-over 把半透明颜色叠到下层实际颜色上，得到肉眼看到的单一颜色。 */
export function compositeVisualColor(color: VisualParsedColor, base: VisualColor): VisualColor {
  if (color.alpha === 1) return color.rgb;
  const blend = (index: 0 | 1 | 2) => Math.round(color.rgb[index] * color.alpha + base[index] * (1 - color.alpha));
  return [blend(0), blend(1), blend(2)];
}
