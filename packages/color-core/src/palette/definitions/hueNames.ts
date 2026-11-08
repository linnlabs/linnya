import type { Oklch } from '../../definitions/color.js'
import { isHueWithinArc, normalizeHue } from '../../functions/hue.js'
import type { PaletteTone } from './palette.js'

/**
 * 按 OKLCH 色相锚定的中文色名。区间不等宽：按各色相在 OKLCH 里的实际位置划分
 * （例如纯红约 29°、纯黄约 110°、纯蓝约 264°），而不是 HSL 的 30° 一档。
 */
const HUE_NAME_BINS: readonly { readonly from: number; readonly to: number; readonly name: string }[] = [
  { from: 350, to: 20, name: '红' },
  { from: 20, to: 42, name: '朱' },
  { from: 42, to: 62, name: '橙' },
  { from: 62, to: 88, name: '琥珀' },
  { from: 88, to: 115, name: '黄' },
  { from: 115, to: 138, name: '黄绿' },
  { from: 138, to: 165, name: '绿' },
  { from: 165, to: 205, name: '青' },
  { from: 205, to: 245, name: '蓝' },
  { from: 245, to: 280, name: '靛' },
  { from: 280, to: 318, name: '紫' },
  { from: 318, to: 350, name: '品红' },
]

export function hueName(hue: number): string {
  return HUE_NAME_BINS.find(bin => isHueWithinArc(hue, bin.from, bin.to))?.name ?? '红'
}

/** 本色的短名：按色相取名，再按明度、彩度加“深、浅、灰”，橙到黄一带的暗色叫“褐”，亮而有彩的叫“金”。 */
export function subjectColorName(color: Oklch): string {
  const base = hueName(color.h)
  if (isHueWithinArc(color.h, 42, 85) && color.l < 0.58 && color.c < 0.13) return color.l < 0.4 ? '深褐' : '褐'
  if (isHueWithinArc(color.h, 85, 125) && color.l < 0.62 && color.c < 0.11) return '橄榄'
  if (isHueWithinArc(color.h, 70, 100) && color.l >= 0.58 && color.l < 0.9 && color.c >= 0.08) return '金'
  if (color.c < 0.05) return `灰${base}`
  if (color.l < 0.42) return `深${base}`
  if (color.l > 0.82) return `浅${base}`
  return base
}

/** 色相区间的说明，如“品红315°-15°”：按区间中点取名。 */
export function hueRangeLabel(from: number, to: number): string {
  const middle = normalizeHue(from + normalizeHue(to - from) / 2)
  return `${hueName(middle)}${Math.round(normalizeHue(from))}°-${Math.round(normalizeHue(to))}°`
}

/** 色调的中文名，沿用 PCCS 的叫法。 */
export const PALETTE_TONE_NAMES: Readonly<Record<PaletteTone, string>> = {
  native: '本色',
  light: '浅',
  bright: '明',
  soft: '柔',
  dull: '浊',
  strong: '强',
  deep: '深',
  dark: '暗',
  grayish: '灰',
}

/**
 * 粗分的色系：一眼看过去算“同一类颜色”的范围，用来衡量几套配色是不是只换了深浅。
 * 按 OKLCH 色相分类（OKLCH 里纯红约 29°、橙 55°、黄 110°、绿 142°、青 195°、蓝 264°、品红 328°）；暖色相里偏暗或偏灰的看起来是褐（铜、木、驼色），暗的黄绿看起来是橄榄，各算一类。
 * 彩度很低的颜色不算色系。
 */
const COLOR_FAMILY_BINS: readonly { readonly from: number; readonly to: number; readonly name: string }[] = [
  { from: 355, to: 40, name: '红' },
  { from: 40, to: 70, name: '橙' },
  { from: 70, to: 115, name: '黄' },
  { from: 115, to: 175, name: '绿' },
  { from: 175, to: 215, name: '青' },
  { from: 215, to: 275, name: '蓝' },
  { from: 275, to: 320, name: '紫' },
  { from: 320, to: 355, name: '品红' },
]

/** 暖色相（40°–100°）低于这个明度或彩度时算褐；100°–130° 低于这个明度时算橄榄。暗红（低于 40°）仍算红。 */
const BROWN_HUES = { min: 40, max: 100 } as const
const OLIVE_HUES = { min: 100, max: 130 } as const
const EARTHY_MAX_LIGHTNESS = 0.66
const EARTHY_MAX_CHROMA = 0.07

export function colorFamily(color: Oklch, minChroma: number): string | null {
  if (color.c < minChroma) return null
  if (isHueWithinArc(color.h, BROWN_HUES.min, BROWN_HUES.max) && (color.l < EARTHY_MAX_LIGHTNESS || color.c < EARTHY_MAX_CHROMA)) return '褐'
  if (isHueWithinArc(color.h, OLIVE_HUES.min, OLIVE_HUES.max) && color.l < EARTHY_MAX_LIGHTNESS) return '橄榄'
  return COLOR_FAMILY_BINS.find(bin => isHueWithinArc(color.h, bin.from, bin.to))?.name ?? '红'
}
