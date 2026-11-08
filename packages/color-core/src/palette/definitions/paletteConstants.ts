import type { PaletteBase, PaletteRelation } from './palette.js'

/**
 * 配色系统的常量。数值来自离线样张标定（青铜器、光合作用、工商业储能三组 Agent 实际收集的图），
 * 改动前先重出样张对照；README 记录口径。
 */

// —— 取色 ——

/** 量化时每张图的颜色数。 */
export const QUANTIZE_COLOR_COUNT = 48
/** k-means 最多迭代次数。 */
export const KMEANS_MAX_ITERATIONS = 12
/** 画面边角相对中心的像素权重。 */
export const EDGE_PIXEL_WEIGHT = 0.5
/**
 * 主图（第一张）是 Agent 选定的主视觉，应主导取色：权重至少 PRIMARY_IMAGE_MIN_WEIGHT，
 * 图多时占全部权重的 PRIMARY_IMAGE_SHARE，不被其余图片稀释。
 */
export const PRIMARY_IMAGE_MIN_WEIGHT = 1.5
export const PRIMARY_IMAGE_SHARE = 0.25
/** 低于这个 OKLCH 彩度的颜色只算中性色。 */
export const CHROMATIC_MIN_CHROMA = 0.032
/** 明度过低或过高时色相不可靠，也只算中性色。 */
export const CHROMATIC_MIN_LIGHTNESS = 0.2
export const CHROMATIC_MAX_LIGHTNESS = 0.94
/** 同一色相族：与族平均色相相差不超过这个角度。 */
export const HUE_FAMILY_RADIUS = 18
/** 一个色相族在某张图里至少占这个比例，才算“出现在这张图里”。 */
export const IMAGE_PRESENCE_MIN_SHARE = 0.02
/** 题材本色的最低总占比。 */
export const SUBJECT_MIN_SHARE = 0.025
/** 只在一张图里出现（且不是主图）的颜色降权。 */
export const SINGLE_IMAGE_PENALTY = 0.4
/** 次要本色的分数至少是首位的这个比例。 */
export const SECONDARY_SUBJECT_MIN_SCORE_RATIO = 0.22
/** 本色之间至少相差的色相。 */
export const SUBJECT_MIN_HUE_SEPARATION = 30
/**
 * 次要本色与已选本色最多相差的色相。更远的颜色落在对侧一带（例如叶绿与切片染色的紫），
 * 与主题色同稿就是用户明确不要的“相反色同框”，不选为本色。
 */
export const SUBJECT_MAX_HUE_SPREAD = 120
/** 打分：占比为主，其次是出现在几张图里（跨图共识），再次是接近目标彩度。 */
export const SUBJECT_TARGET_CHROMA = 0.1
export const SUBJECT_SHARE_WEIGHT = 0.6
export const SUBJECT_PRESENCE_WEIGHT = 0.25
export const SUBJECT_CHROMA_WEIGHT = 0.15
export const MAX_SUBJECT_COLORS = 3
export const MAX_NEUTRAL_COLORS = 3

// —— 排除区 ——

/** 本色对侧：从本色色相 +150° 到 +210°。 */
export const OPPOSITE_HUE_FROM = 150
export const OPPOSITE_HUE_TO = 210
/** `avoid` 颜色两侧各排除的角度。 */
export const AVOID_HUE_RADIUS = 30
/** 生成的颜色与排除区边缘至少保留的角度。 */
export const EXCLUSION_MARGIN = 6
/** 低于这个彩度的生成色视为中性，不受排除区限制。 */
export const NEUTRAL_MAX_CHROMA = 0.02

// —— 对比度下限（WCAG 2.x）——

export const INK_MIN_CONTRAST = 7
export const MUTED_MIN_CONTRAST = 4.5
export const ACCENT_MIN_CONTRAST = 3

// —— 生成：各底色明暗下的角色明度与彩度 ——

export interface RangeValue {
  readonly min: number
  readonly max: number
}

export interface BaseTones {
  readonly bgLightness: RangeValue
  readonly bgChroma: RangeValue
  /** 面色相对底色的明度差（深底为正、浅底为负）。 */
  readonly surfaceLightnessOffset: number
  readonly surfaceChromaOffset: number
  readonly inkLightness: number
  readonly inkChroma: number
  readonly mutedLightness: number
  readonly mutedChroma: number
  /** 点题色的期望明度区间；本色明度会被夹进来。 */
  readonly accentLightness: RangeValue
  /** 图表系列首尾的明度。 */
  readonly chartLightness: readonly [number, number]
}

export const BASE_TONES: Readonly<Record<PaletteBase, BaseTones>> = {
  light: {
    bgLightness: { min: 0.982, max: 0.99 },
    bgChroma: { min: 0.002, max: 0.006 },
    surfaceLightnessOffset: -0.03,
    surfaceChromaOffset: 0.003,
    inkLightness: 0.24,
    inkChroma: 0.018,
    mutedLightness: 0.5,
    mutedChroma: 0.02,
    accentLightness: { min: 0.4, max: 0.58 },
    chartLightness: [0.42, 0.87],
  },
  tint: {
    bgLightness: { min: 0.948, max: 0.962 },
    bgChroma: { min: 0.013, max: 0.022 },
    surfaceLightnessOffset: -0.035,
    surfaceChromaOffset: 0.004,
    inkLightness: 0.26,
    inkChroma: 0.034,
    mutedLightness: 0.49,
    mutedChroma: 0.034,
    accentLightness: { min: 0.38, max: 0.55 },
    chartLightness: [0.4, 0.84],
  },
  dark: {
    bgLightness: { min: 0.185, max: 0.215 },
    bgChroma: { min: 0.012, max: 0.024 },
    surfaceLightnessOffset: 0.05,
    surfaceChromaOffset: 0.004,
    inkLightness: 0.94,
    inkChroma: 0.012,
    mutedLightness: 0.74,
    mutedChroma: 0.02,
    accentLightness: { min: 0.68, max: 0.8 },
    chartLightness: [0.86, 0.46],
  },
}

/** 底色彩度不超过本色彩度的这个比例：本色本身发灰（如灰青铜锈），纸也跟着收，不染成薄荷。 */
export const PAPER_MAX_SUBJECT_CHROMA_RATIO = 0.5

/** “墨色主导”时底、面、墨、弱墨的彩度上限：几乎中性，只留一丝本色。 */
export const INK_RELATION_MAX_CHROMA = 0.006

/**
 * 米色带：这一段色相的浅色调读作米色、奶油色，是基准里反复出现的默认底色（用户要求染纸“不要米白”）。
 * 染纸底与双本色的底色色相避开这一段；没有别的本色时不出染纸底。
 */
export const BEIGE_HUES: RangeValue = { min: 45, max: 100 }

/** 点题色彩度区间：本色彩度夹进来，既不脏也不艳。 */
export const ACCENT_CHROMA: RangeValue = { min: 0.07, max: 0.15 }
/** 图表系列首色的彩度区间；越浅越淡。 */
export const CHART_CHROMA: RangeValue = { min: 0.06, max: 0.13 }
/** 图表末色相对首色保留的彩度比例。 */
export const CHART_CHROMA_TAPER = 0.45
export const CHART_SERIES_COUNT = 5

/** 邻近色：点题色与本色的色相差。 */
export const ANALOG_HUE_SHIFT: RangeValue = { min: 30, max: 55 }

/** 每次随机的微调幅度。 */
export const ACCENT_LIGHTNESS_JITTER = 0.04
export const ACCENT_CHROMA_JITTER = 0.1

/** 组合的先验权重；随机抽取时按此加权。 */
export const COMBINATION_WEIGHTS: Readonly<Record<PaletteRelation, Readonly<Record<PaletteBase, number>>>> = {
  mono: { light: 0.6, tint: 1, dark: 0.8 },
  analog: { light: 0.7, tint: 0.6, dark: 0.6 },
  ink: { light: 1, tint: 0.5, dark: 0.7 },
  dual: { light: 0.8, tint: 0.8, dark: 1 },
}

export const DEFAULT_PALETTE_COUNT = 3
export const MAX_PALETTE_COUNT = 5
