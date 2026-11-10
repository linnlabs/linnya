import { rgbToOklch } from '../../functions/colorSpace.js'
import { parseColor } from '../../functions/parseColor.js'
import { colorFamily } from '../definitions/hueNames.js'
import type { PaletteBase } from '../definitions/palette.js'
import { FAMILY_MIN_CHROMA, GROUND_VARIANTS, TINTED_BG_CHROMA } from '../definitions/paletteConstants.js'

function lightnessSpan(base: PaletteBase): { readonly min: number, readonly max: number } {
  const spans = GROUND_VARIANTS[base].map(variant => variant.bgLightness)
  return { min: Math.min(...spans.map(span => span.min)), max: Math.max(...spans.map(span => span.max)) }
}

const DARK = lightnessSpan('dark')
const TINT = lightnessSpan('tint')
const LIGHT = lightnessSpan('light')
/** 分界取相邻两档生成区间的中点：配色建议给的底色落回原档，手写的底色归到最近的一档。 */
const DARK_TINT_BOUNDARY = (DARK.max + TINT.min) / 2
const TINT_LIGHT_BOUNDARY = (TINT.max + LIGHT.min) / 2

export interface PaletteLook {
  readonly base: PaletteBase
  /** 用到的色系名（如 蓝、青、褐），按强调色顺序，底色有色系时排在最后。 */
  readonly families: readonly string[]
}

/**
 * 只有颜色值时说出一套配色的样子：底色是浅底、染纸还是深底，用到哪些色系。
 * 与配色建议的风格名同一口径，计划卡等界面据此给手写的配色和建议的配色取一样的名字。
 */
export function describePalette(bg: string, accents: readonly string[]): PaletteLook | null {
  const ground = parseColor(bg)
  if (!ground) return null
  const groundColor = rgbToOklch(ground.channels)
  const base: PaletteBase = groundColor.l < DARK_TINT_BOUNDARY ? 'dark' : groundColor.l < TINT_LIGHT_BOUNDARY ? 'tint' : 'light'
  const families = new Set<string>()
  for (const hex of accents) {
    const parsed = parseColor(hex)
    const family = parsed ? colorFamily(rgbToOklch(parsed.channels), FAMILY_MIN_CHROMA) : null
    if (family) families.add(family)
  }
  const groundFamily = colorFamily(groundColor, TINTED_BG_CHROMA)
  if (groundFamily) families.add(groundFamily)
  return { base, families: [...families] }
}
