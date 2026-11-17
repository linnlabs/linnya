/**
 * 颜色方向原型用的 OKLCH 换算（计划阶段，画廊专用）。
 * 产出 CSS `oklch()` 字符串给浏览器直接渲染；对比度按 sRGB 相对亮度计算。
 */
export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

function toLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function hexToOklch(hex: string): Oklch {
  const raw = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(index => toLinear(Number.parseInt(raw.slice(index, index + 2), 16)));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: lightness, c: Math.hypot(a, bb), h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 };
}

/** 线性 sRGB；超出 0–1 表示不在 sRGB 色域内。 */
function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
}

/** 色域外时降彩度直到落进 sRGB，保持明度与色相。 */
export function clampToGamut(color: Oklch): Oklch {
  let chroma = color.c;
  while (chroma > 0) {
    const rgb = oklchToLinearRgb({ ...color, c: chroma });
    if (rgb.every(value => value >= -0.0001 && value <= 1.0001)) break;
    chroma -= 0.002;
  }
  return { ...color, c: Math.max(chroma, 0) };
}

export function relativeLuminance(color: Oklch): number {
  const [r, g, b] = oklchToLinearRgb(clampToGamut(color)).map(value => Math.min(Math.max(value, 0), 1));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(first: Oklch, second: Oklch): number {
  const [low, high] = [relativeLuminance(first), relativeLuminance(second)].sort((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
}

export function css(color: Oklch): string {
  const safe = clampToGamut(color);
  return `oklch(${safe.l.toFixed(4)} ${safe.c.toFixed(4)} ${safe.h.toFixed(1)})`;
}

export function hexOf(color: Oklch): string {
  const encode = (value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    const gamma = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(gamma * 255).toString(16).padStart(2, '0');
  };
  return `#${oklchToLinearRgb(clampToGamut(color)).map(encode).join('')}`;
}

/** 在明度区间里找满足目标对比度、且尽量接近起点的明度（向更深或更浅单向搜索）。 */
export function fitLightness(start: Oklch, against: Oklch, target: number, direction: 'darker' | 'lighter'): Oklch {
  let color = start;
  const step = direction === 'darker' ? -0.005 : 0.005;
  for (let index = 0; index < 120 && contrast(color, against) < target; index += 1) {
    color = { ...color, l: color.l + step };
  }
  return color;
}

export const WHITE: Oklch = { l: 1, c: 0, h: 0 };
