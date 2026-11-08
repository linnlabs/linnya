import type { Oklch } from '../../definitions/color.js'
import { isHueWithinArc, normalizeHue } from '../../functions/hue.js'

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
  if (isHueWithinArc(color.h, 70, 100) && color.l >= 0.58 && color.l < 0.82 && color.c >= 0.08) return '金'
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
