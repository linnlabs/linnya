import type { Oklab, Oklch, RgbChannels } from '../definitions/color.js'

/**
 * sRGB、线性 sRGB、OKLab 与 OKLCH 的互转（Björn Ottosson 公式）。
 *
 * OKLCH 把明度 L、彩度 C、色相 h 分开：保持色相调明度、按色相判断颜色关系都在这里算。
 */

const GAMUT_EPSILON = 1e-4
/** CSS Color 4 色域映射：剪裁误差低于这个 ΔEOK 即视为看不出差别。 */
const GAMUT_MAPPING_JND = 0.02
const GAMUT_MAPPING_EPSILON = 1e-4

/** 0–255 的 sRGB 通道 → 0–1 的线性光。 */
export function srgbChannelToLinear(channel: number): number {
  const scaled = channel / 255
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
}

/** 线性光 → 0–255 的 sRGB 通道；先截到 0–1。 */
export function linearToSrgbChannel(value: number): number {
  const clamped = Math.min(1, Math.max(0, value))
  const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
  return encoded * 255
}

export function rgbToOklab(rgb: RgbChannels): Oklab {
  const red = srgbChannelToLinear(rgb[0])
  const green = srgbChannelToLinear(rgb[1])
  const blue = srgbChannelToLinear(rgb[2])
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/** OKLab → 线性 sRGB；结果可能超出 0–1（即超出 sRGB 色域）。 */
export function oklabToLinearRgb(color: Oklab): [number, number, number] {
  const l = (color.l + 0.3963377774 * color.a + 0.2158037573 * color.b) ** 3
  const m = (color.l - 0.1055613458 * color.a - 0.0638541728 * color.b) ** 3
  const s = (color.l - 0.0894841775 * color.a - 1.291485548 * color.b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

export function oklabToOklch(color: Oklab): Oklch {
  return { l: color.l, c: Math.hypot(color.a, color.b), h: ((Math.atan2(color.b, color.a) * 180) / Math.PI + 360) % 360 }
}

export function oklchToOklab(color: Oklch): Oklab {
  const chroma = Math.max(0, color.c)
  const hue = (color.h * Math.PI) / 180
  return { l: color.l, a: chroma * Math.cos(hue), b: chroma * Math.sin(hue) }
}

export function rgbToOklch(rgb: RgbChannels): Oklch {
  return oklabToOklch(rgbToOklab(rgb))
}

export function isLinearRgbInGamut(linear: readonly [number, number, number]): boolean {
  return linear.every(value => value >= -GAMUT_EPSILON && value <= 1 + GAMUT_EPSILON)
}

/** 两个 OKLab 颜色的欧氏距离（ΔEOK）。 */
export function deltaEOK(left: Oklab, right: Oklab): number {
  return Math.hypot(left.l - right.l, left.a - right.a, left.b - right.b)
}

function clipToSrgb(color: Oklch): { readonly rgb: [number, number, number]; readonly lab: Oklab } {
  const linear = oklabToLinearRgb(oklchToOklab(color))
  const rgb: [number, number, number] = [linearToSrgbChannel(linear[0]), linearToSrgbChannel(linear[1]), linearToSrgbChannel(linear[2])]
  return { rgb, lab: rgbToOklab(rgb) }
}

function inSrgbGamut(color: Oklch): boolean {
  return isLinearRgbInGamut(oklabToLinearRgb(oklchToOklab(color)))
}

export interface OklchToRgbOptions {
  /**
   * 剪裁容差（ΔEOK）。默认 0.02，即 CSS Color 4：允许看不出差别的剪裁以保留彩度，代价是低彩度时
   * 色相可能偏几度。传 0 时只降彩度、不剪裁，明度与色相严格不变；按色相判断颜色关系的场合用它。
   */
  readonly jnd?: number
}

/**
 * OKLCH → sRGB（0–255，可带小数）。超出色域时按 CSS Color 4 的色域映射：保持明度与色相，二分降低彩度，
 * 直到剪裁结果与目标的 ΔEOK 小于 `jnd`。明度 ≥ 1 或 ≤ 0 时直接给白或黑。
 */
export function oklchToRgb(color: Oklch, options: OklchToRgbOptions = {}): [number, number, number] {
  const jnd = Math.max(0, options.jnd ?? GAMUT_MAPPING_JND)
  if (color.l >= 1) return [255, 255, 255]
  if (color.l <= 0) return [0, 0, 0]
  const origin: Oklch = { l: color.l, c: Math.max(0, color.c), h: color.h }
  if (inSrgbGamut(origin)) return clipToSrgb(origin).rgb
  let clipped = clipToSrgb(origin)
  if (jnd > 0 && deltaEOK(clipped.lab, oklchToOklab(origin)) < jnd) return clipped.rgb
  let min = 0
  let max = origin.c
  let minInGamut = true
  while (max - min > GAMUT_MAPPING_EPSILON) {
    const chroma = (min + max) / 2
    const current: Oklch = { l: origin.l, c: chroma, h: origin.h }
    if (minInGamut && inSrgbGamut(current)) {
      min = chroma
      continue
    }
    if (jnd > 0) {
      clipped = clipToSrgb(current)
      const error = deltaEOK(clipped.lab, oklchToOklab(current))
      if (error < jnd) {
        if (jnd - error < GAMUT_MAPPING_EPSILON) return clipped.rgb
        minInGamut = false
        min = chroma
        continue
      }
    }
    max = chroma
  }
  return jnd > 0 ? clipped.rgb : clipToSrgb({ l: origin.l, c: min, h: origin.h }).rgb
}
