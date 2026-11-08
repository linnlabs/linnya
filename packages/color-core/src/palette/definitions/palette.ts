import type { Oklch } from '../../definitions/color.js'

/** 调用方解码好的一张图：RGBA 8 位，建议先缩到长边 128 px。 */
export interface PaletteImagePixels {
  readonly width: number
  readonly height: number
  /** 长度为 width × height × 4 的 RGBA。 */
  readonly data: Uint8Array | Uint8ClampedArray
}

/**
 * 每套配色的色相关系（借鉴 PCCS 按色相差的分类）：同色系、灰 + 主色、邻近色（25°–50°）、中差色（60°–105°）、
 * 对照色（110°–144°）、图片多色（三种以上图片色统一色调）。不用补色。
 */
export type PaletteRelation = 'mono' | 'ink' | 'analog' | 'medium' | 'contrast' | 'multi'

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
  /** 点缀色：面积小但鲜明（如展厅的红墙、机柜上的绿条），只在多色系搭配里出现。 */
  readonly spot: boolean
  /** 用户指定的颜色：排在最前，是每套的主色，不来自图片（`share`、`images` 为 0）。 */
  readonly pinned: boolean
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
  /** 强调色，第一种最重要（主色）；数量默认按关系给，调用方可以指定 1–6 个，对应 PowerPoint 的 accent1–6。 */
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

export type PaletteFailure =
  | { readonly kind: 'no_subject_color' }
  /** 指定色太接近黑白灰，没有色相，不能当主色。 */
  | { readonly kind: 'pinned_color_neutral'; readonly hex: string }
  /** 指定色在要求的底色上达不到对比度（如浅黄配浅底），一套也做不出。 */
  | { readonly kind: 'pinned_color_conflict' }

export interface SuggestPalettesInput {
  /** 第一张是主图，权重更高。 */
  readonly images?: readonly PaletteImagePixels[]
  /** 额外的本色（无图时就是本色）。 */
  readonly seedColors?: readonly string[]
  /**
   * 用户指定的颜色，1–6 个，第一个是主色。每套的前几个强调色就是这些色值；对比度不够时调底色明暗，不改指定色。
   * 排除区以它为准：落在指定色对侧的图片色被丢弃。
   */
  readonly pinnedColors?: readonly string[]
  /** 套数，1–5，默认 3。 */
  readonly count?: number
  /** 只要某种底色明暗。 */
  readonly base?: PaletteBase
  /** 每套几个强调色，1–6；不传则按关系给默认数量。 */
  readonly accentCount?: number
  /** 额外排除的颜色，按其色相 ±30° 排除。 */
  readonly avoidColors?: readonly string[]
  /** 之前结果的编号（如 `pl8f2a`）；不传则随机。 */
  readonly rng?: string
}

/** 待检查的一套配色（Agent 自己写的，或用户给的色板）。 */
export interface PaletteDraft {
  readonly bg: string
  readonly surface: string
  readonly ink: string
  readonly muted: string
  readonly accent: readonly string[]
  readonly chart: readonly string[]
}

export type PaletteCheckRule = 'invalid_color' | 'ink_contrast' | 'muted_contrast' | 'accent_contrast' | 'excluded_hue' | 'chart_order'

export interface PaletteFinding {
  readonly rule: PaletteCheckRule
  /** 角色：`bg`、`surface`、`ink`、`muted`、`accent[0]`、`chart[2]`；`chart_order` 时是 `chart`。 */
  readonly role: string
  readonly value: string
  /** 对比度规则的实测值与下限。 */
  readonly measured?: number
  readonly required?: number
}

export interface CheckPaletteInput {
  readonly palette: PaletteDraft
  /** 之前 `suggestPalettes` 返回的排除区；不传则不查。 */
  readonly excludedHues?: readonly HueRange[]
  /** 用户指定的颜色：出现在任何角色上都不改动，也不受排除区约束。 */
  readonly pinnedColors?: readonly string[]
}

export interface PaletteCheckResult {
  readonly ok: boolean
  readonly findings: readonly PaletteFinding[]
  /** 改动最少的合格版本：只动有问题的角色。已合格或改不出来（如两个指定色彼此对比度不够）时为 null。 */
  readonly suggested: PaletteDraft | null
}
