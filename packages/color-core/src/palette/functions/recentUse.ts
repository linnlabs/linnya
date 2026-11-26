import type { Palette, PaletteBase, PaletteCombination } from '../definitions/palette.js'
import { RECENT_USE_WINDOWS } from '../definitions/paletteConstants.js'
import { paletteFamilies } from './scorePalette.js'

/** 色系按名称排序，同一组合不论色系出现先后都写成同一个样子。 */
export function combinationOf(base: PaletteBase, families: Iterable<string>): PaletteCombination {
  return { base, families: [...families].sort() }
}

/** 一套配色的组合：底色明暗加色系集合，与 `paletteDistance` 衡量差异的主维度相同。 */
export function paletteCombination(palette: Palette): PaletteCombination {
  return combinationOf(palette.base, paletteFamilies(palette))
}

/** 色系是集合：比较时不看先后。 */
function sameCombination(left: PaletteCombination, right: PaletteCombination): boolean {
  return left.base === right.base
    && left.families.length === right.families.length
    && left.families.every(family => right.families.includes(family))
}

/**
 * 挑选时乘在抽取权重上的系数：按这个组合最近一次被选用排在第几位，落在哪个窗口就取哪个系数，没用过为 1。
 * `recent` 由近到远；同一组合用了几次只看最近那一次，不叠乘，否则连用几次会被压到几乎抽不到，变成排除。
 */
export function recentUseFactor(combination: PaletteCombination, recent: readonly PaletteCombination[]): number {
  const position = recent.findIndex(used => sameCombination(used, combination))
  if (position < 0) return 1
  return RECENT_USE_WINDOWS.find(window => position < window.uses)?.factor ?? 1
}
