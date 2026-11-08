import type { Oklch } from '../../definitions/color.js'

/** 调用方解码好的一张图：RGBA 8 位，建议先缩到长边 128 px。 */
export interface PaletteImagePixels {
  readonly width: number
  readonly height: number
  /** 长度为 width × height × 4 的 RGBA。 */
  readonly data: Uint8Array | Uint8ClampedArray
}

/** 每套配色的搭配关系。 */
export type PaletteRelation = 'mono' | 'analog' | 'ink' | 'dual'

/** 底色明暗：浅底（近白纸）、染纸底、深底。 */
export type PaletteBase = 'light' | 'tint' | 'dark'

/**
 * 点题与图表的色调（借鉴 PCCS）：`native` 是本色自己的色调；浅底与染纸上有柔、浊、深、暗、强、灰，
 * 深底上有浅、柔、明、灰。
 */
export type PaletteTone = 'native' | 'light' | 'bright' | 'soft' | 'dull' | 'strong' | 'deep' | 'dark' | 'grayish'

export interface SubjectColor {
  readonly hex: string
  /** 中文短名，只作说明；调用方可以改叫更贴切的名字。 */
  readonly name: string
  /** 在全部图片（按图权重）里所占的比例，0–1。 */
  readonly share: number
  /** 出现在几张图里。 */
  readonly images: number
  readonly oklch: Oklch
}

export interface Palette {
  readonly id: string
  readonly relation: PaletteRelation
  readonly base: PaletteBase
  readonly tone: PaletteTone
  readonly bg: string
  readonly surface: string
  readonly ink: string
  readonly muted: string
  /** 1–2 种点题色，第一种最重要。 */
  readonly accent: readonly string[]
  /** 图表系列，按明度单调排列；数组顺序即视觉顺序。 */
  readonly chart: readonly string[]
}

/** 被排除的色相区间：从 `from` 顺时针到 `to`（OKLCH 色相，度）。 */
export type HueRange = readonly [number, number]

export interface PaletteSuggestion {
  readonly kind: 'palettes'
  readonly id: string
  readonly subject: readonly SubjectColor[]
  readonly neutrals: readonly string[]
  readonly excludedHues: readonly HueRange[]
  readonly palettes: readonly Palette[]
}

export interface PaletteFailure {
  readonly kind: 'no_subject_color'
}

export interface SuggestPalettesInput {
  /** 第一张是主图，权重更高。 */
  readonly images?: readonly PaletteImagePixels[]
  /** 额外的本色（无图时就是本色）。 */
  readonly seedColors?: readonly string[]
  /** 套数，1–5，默认 3。 */
  readonly count?: number
  /** 只要某种底色明暗。 */
  readonly base?: PaletteBase
  /** 额外排除的颜色，按其色相 ±30° 排除。 */
  readonly avoidColors?: readonly string[]
  /** 之前结果的编号（如 `pl8f2a`）；不传则随机。 */
  readonly rng?: string
}
