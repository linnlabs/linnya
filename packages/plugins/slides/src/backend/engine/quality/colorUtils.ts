/**
 * 颜色工具函数集
 *
 * 服务于 AestheticLint 颜色 / 对比度 / 跨页主色一致性规则。
 *
 * 设计原则：
 * - 纯函数、无状态、零外部依赖
 * - 输入容错：所有解析函数对非法输入返回 `null`，不抛错
 * - 单位精确：HSL 中 H 用度（0-360），S/L 用 0-1 范围
 */

export interface RgbColor {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

export interface HslColor {
  h: number; // 0-360 (灰阶时为 0)
  s: number; // 0-1
  l: number; // 0-1
}

/**
 * 解析 hex 字符串为 RGB。支持：
 * - `#RGB`、`#RRGGBB`
 * - `RGB`、`RRGGBB`（无 #）
 * - 大小写不敏感、首尾空白容错
 * - `#RRGGBBAA` / `#RGBA`：忽略 alpha 通道，仅用前 6/3 位
 *
 * 失败返回 null。
 */
export function parseHex(input: string | undefined | null): RgbColor | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().replace(/^#/, '');
  if (trimmed.length === 0) return null;

  let hex: string;
  if (trimmed.length === 3 || trimmed.length === 4) {
    /* #RGB / #RGBA */
    hex = trimmed
      .slice(0, 3)
      .split('')
      .map((c) => c + c)
      .join('');
  } else if (trimmed.length === 6 || trimmed.length === 8) {
    hex = trimmed.slice(0, 6);
  } else {
    return null;
  }

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;

  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

/**
 * 将 RGB（0-255）转 HSL。H 用度（0-360），S/L 用 0-1。
 * 灰阶（max == min）H 返回 0，S 返回 0。
 */
export function rgbToHsl(rgb: RgbColor): HslColor {
  const r = clamp01(rgb.r / 255);
  const g = clamp01(rgb.g / 255);
  const b = clamp01(rgb.b / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      break;
    case g:
      h = ((b - r) / d + 2) * 60;
      break;
    case b:
      h = ((r - g) / d + 4) * 60;
      break;
  }
  return { h, s, l };
}

/**
 * 中性色判定：饱和度极低 / 极暗 / 极亮 视为中性，不参与"主色"统计。
 *
 * 阈值参考：
 * - s < 0.10：低饱和（近灰）
 * - l < 0.08：近黑
 * - l > 0.92：近白
 *
 * 中性色阈值刻意保守——边界模糊地带（如低饱和米色 #F5F0E8）保留为主色，
 * 避免漏报"用了 5 种相近米色"这种实际仍紊乱的设计。
 */
export function isNeutralColor(hsl: HslColor): boolean {
  if (hsl.s < 0.1) return true;
  if (hsl.l < 0.08) return true;
  if (hsl.l > 0.92) return true;
  return false;
}

/**
 * sRGB → 相对亮度（WCAG 2.x 定义）。返回 0-1。
 * 用于对比度计算。
 */
export function relativeLuminance(rgb: RgbColor): number {
  const channel = (c: number): number => {
    const v = clamp01(c / 255);
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/**
 * WCAG 对比度比 = (Lmax + 0.05) / (Lmin + 0.05)。
 * 范围 1.0（同色）— 21.0（纯黑/纯白）。
 */
export function wcagContrastRatio(c1: RgbColor, c2: RgbColor): number {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  const lmax = Math.max(l1, l2);
  const lmin = Math.min(l1, l2);
  return (lmax + 0.05) / (lmin + 0.05);
}

/**
 * 圆形（角度）方差的 stddev，单位：度。用于跨页主色 hue 漂移检测。
 *
 * 算法：把每个角度映射到单位圆 (cos, sin)，求平均向量长度 R ∈ [0,1]，
 * stddev = sqrt(-2 * ln(R)) * (180 / PI)。
 *
 * - R = 1（所有角度同向）→ stddev = 0
 * - R → 0（角度均匀分布）→ stddev → ∞
 *
 * 返回值上限截断在 180°（因为 hue 是周期 360°，180° 已经是最大可能离散）。
 * 输入空数组或单元素返回 0。
 */
export function circularStdDeviationDeg(huesDeg: number[]): number {
  if (huesDeg.length < 2) return 0;
  let sumCos = 0;
  let sumSin = 0;
  for (const h of huesDeg) {
    const rad = (h * Math.PI) / 180;
    sumCos += Math.cos(rad);
    sumSin += Math.sin(rad);
  }
  const meanCos = sumCos / huesDeg.length;
  const meanSin = sumSin / huesDeg.length;
  const r = Math.sqrt(meanCos * meanCos + meanSin * meanSin);
  if (r >= 1 - 1e-9) return 0;
  if (r <= 1e-9) return 180;
  const stddevRad = Math.sqrt(-2 * Math.log(r));
  const stddevDeg = (stddevRad * 180) / Math.PI;
  return Math.min(180, stddevDeg);
}

/** hue 的圆形平均值，返回 [0, 360)；空输入返回 0。 */
export function circularMeanDeg(huesDeg: number[]): number {
  if (huesDeg.length === 0) return 0;
  let sumCos = 0;
  let sumSin = 0;
  for (const hue of huesDeg) {
    const radians = (hue * Math.PI) / 180;
    sumCos += Math.cos(radians);
    sumSin += Math.sin(radians);
  }
  const degrees = (Math.atan2(sumSin, sumCos) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
