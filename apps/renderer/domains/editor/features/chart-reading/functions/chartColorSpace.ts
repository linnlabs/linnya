/**
 * @file chartColorSpace.ts
 * @description sRGB 与 OKLCH 的互转（Ottosson 公式），含色域内压缩。
 *
 * OKLCH 将明度 L、彩度 C、色相 h 分开，用于保持色相的细线明度调整；它不负责选择或重排色板。
 * 这里只做数学，不认识图表；描线色的派生规则在 chartPalette.ts。
 */

/** 0–255 的 sRGB 通道。 */
export type RgbChannels = readonly [number, number, number]

export interface Oklch {
  /** 明度，0（黑）– 1（白）。 */
  readonly l: number
  /** 彩度，0 为灰；sRGB 内最大约 0.32。 */
  readonly c: number
  /** 色相角，0–360°。 */
  readonly h: number
}

const GAMUT_EPSILON = 1e-4
const MAX_COMPRESSION_STEPS = 80
const COMPRESSION_FACTOR = 0.97

function srgbToLinear(channel: number): number {
  const scaled = channel / 255
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(value: number): number {
  const clamped = Math.min(1, Math.max(0, value))
  const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
  return encoded * 255
}

export function rgbToOklch(rgb: RgbChannels): Oklch {
  const [red, green, blue] = [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])]
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { l: lightness, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }
}

function oklabToLinear(lightness: number, a: number, b: number): [number, number, number] {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function isInGamut(linear: readonly [number, number, number]): boolean {
  return linear.every(value => value >= -GAMUT_EPSILON && value <= 1 + GAMUT_EPSILON)
}

/**
 * OKLCH → sRGB。超出 sRGB 色域时保持明度与色相、逐步降低彩度，直到落入色域：
 * 低饱和色系不会因为色域截断而偷偷改变明度或色相。
 */
export function oklchToRgb(color: Oklch): [number, number, number] {
  let chroma = Math.max(0, color.c)
  const hue = (color.h * Math.PI) / 180
  for (let step = 0; step < MAX_COMPRESSION_STEPS; step += 1) {
    const linear = oklabToLinear(color.l, chroma * Math.cos(hue), chroma * Math.sin(hue))
    if (isInGamut(linear)) return [linearToSrgb(linear[0]), linearToSrgb(linear[1]), linearToSrgb(linear[2])]
    chroma *= COMPRESSION_FACTOR
  }
  const gray = linearToSrgb(color.l ** 3)
  return [gray, gray, gray]
}
