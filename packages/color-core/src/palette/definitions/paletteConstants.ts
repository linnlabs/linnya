import type { PaletteBase, PaletteRelation, PaletteTone } from './palette.js'

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
/** 其余本色的分数至少是首位的这个比例。小面积但鲜明的颜色（展厅的红墙、机柜上的绿条）也要留下，供多色系搭配用。 */
export const SECONDARY_SUBJECT_MIN_SCORE_RATIO = 0.15
/** 本色之间至少相差的色相。 */
export const SUBJECT_MIN_HUE_SEPARATION = 30
/**
 * 色相差不到 30° 但一眼看去是两种颜色（例如青铜的亮金与橄榄，一亮而鲜、一暗而浊）：色相差至少 10° 且
 * ΔEOK 至少 0.2 时也算两种。两种发灰的绿这类只差深浅的，仍算一种。
 */
export const SUBJECT_NEAR_HUE_SEPARATION = 10
export const SUBJECT_NEAR_MIN_DELTA_E = 0.2
/**
 * 本色之间最多相差的色相：不能落进彼此的对侧排除区（150°–210°，再留 6° 余量）。更远的颜色（例如叶绿与
 * 切片染色的紫）与主题色同稿就是用户明确不要的“相反色同框”，不选为本色。
 */
export const SUBJECT_MAX_HUE_SPREAD = 144
/** 打分：占比为主，其次是出现在几张图里（跨图共识），再次是接近目标彩度。 */
export const SUBJECT_TARGET_CHROMA = 0.1
export const SUBJECT_SHARE_WEIGHT = 0.6
export const SUBJECT_PRESENCE_WEIGHT = 0.25
export const SUBJECT_CHROMA_WEIGHT = 0.15
export const MAX_SUBJECT_COLORS = 4
/**
 * 点缀色：面积小但鲜明的颜色（展厅的红墙、机柜上的绿条）。设计师从照片取色时会留下它们做点缀，
 * 按“占比 × 彩度”排，最多留 MAX_SPOT_COLORS 种，同样要和本色拉开、不落进彼此的对侧。
 */
export const SPOT_MIN_SHARE = 0.004
export const SPOT_MIN_CHROMA = 0.08
export const MAX_SPOT_COLORS = 2
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

// —— 生成：风格基因 ——
//
// 一套配色 = 关系 × 底色明暗 × 底面变体 × 色调，再加图表明度区间、彩度收尾、色相漂移等连续取值。
// 每次先按这些维度采样一批候选，过约束、打分，再按感知差异挑出几套（见 orchestration/suggestPalettes）。

export interface RangeValue {
  readonly min: number
  readonly max: number
}

/** 墨与弱墨的期望明度与彩度；对比度不够时由 fitLightness 沿明度调整。 */
export interface TextTones {
  readonly inkLightness: number
  readonly inkChroma: number
  readonly mutedLightness: number
  readonly mutedChroma: number
}

export const TEXT_TONES: Readonly<Record<PaletteBase, TextTones>> = {
  light: { inkLightness: 0.24, inkChroma: 0.018, mutedLightness: 0.5, mutedChroma: 0.02 },
  tint: { inkLightness: 0.26, inkChroma: 0.034, mutedLightness: 0.49, mutedChroma: 0.034 },
  dark: { inkLightness: 0.94, inkChroma: 0.012, mutedLightness: 0.74, mutedChroma: 0.02 },
}

/** 底色的中性色相：随本色，或偏冷（蓝灰）。彩度都很低，不受排除区限制。 */
export type NeutralHue = 'subject' | 'cool'
export const COOL_NEUTRAL_HUE = 250

/** 底面变体：同一种底色明暗下，纸的明度、彩度与冷暖不同。 */
export interface GroundVariant {
  readonly key: string
  readonly bgLightness: RangeValue
  readonly bgChroma: RangeValue
  /** 底色彩度不超过本色彩度的这个比例：本色发灰时纸也跟着收。 */
  readonly maxSubjectChromaRatio: number
  readonly neutralHue: NeutralHue
  /** 面色相对底色的明度差（深底为正、浅底为负）。 */
  readonly surfaceLightnessOffset: number
  readonly surfaceChromaOffset: number
  /** 先验权重。 */
  readonly weight: number
}

export const GROUND_VARIANTS: Readonly<Record<PaletteBase, readonly GroundVariant[]>> = {
  light: [
    { key: 'tinted', bgLightness: { min: 0.978, max: 0.992 }, bgChroma: { min: 0.002, max: 0.007 }, maxSubjectChromaRatio: 0.5, neutralHue: 'subject', surfaceLightnessOffset: -0.03, surfaceChromaOffset: 0.003, weight: 1 },
    { key: 'cool', bgLightness: { min: 0.978, max: 0.99 }, bgChroma: { min: 0.002, max: 0.005 }, maxSubjectChromaRatio: 1, neutralHue: 'cool', surfaceLightnessOffset: -0.032, surfaceChromaOffset: 0.002, weight: 0.5 },
    { key: 'white', bgLightness: { min: 0.995, max: 1 }, bgChroma: { min: 0, max: 0.0015 }, maxSubjectChromaRatio: 1, neutralHue: 'subject', surfaceLightnessOffset: -0.035, surfaceChromaOffset: 0.003, weight: 0.5 },
  ],
  tint: [
    { key: 'pale', bgLightness: { min: 0.948, max: 0.968 }, bgChroma: { min: 0.01, max: 0.02 }, maxSubjectChromaRatio: 0.5, neutralHue: 'subject', surfaceLightnessOffset: -0.035, surfaceChromaOffset: 0.004, weight: 1 },
    { key: 'paper', bgLightness: { min: 0.922, max: 0.946 }, bgChroma: { min: 0.016, max: 0.028 }, maxSubjectChromaRatio: 0.5, neutralHue: 'subject', surfaceLightnessOffset: -0.035, surfaceChromaOffset: 0.004, weight: 0.6 },
  ],
  dark: [
    { key: 'ink', bgLightness: { min: 0.17, max: 0.215 }, bgChroma: { min: 0.008, max: 0.022 }, maxSubjectChromaRatio: 1, neutralHue: 'subject', surfaceLightnessOffset: 0.05, surfaceChromaOffset: 0.004, weight: 1 },
    // 本色深底：藏青、墨绿、酒红这类有颜色的深底，基准里模型常选、用户也认可。
    { key: 'deep', bgLightness: { min: 0.25, max: 0.32 }, bgChroma: { min: 0.03, max: 0.055 }, maxSubjectChromaRatio: 1.1, neutralHue: 'subject', surfaceLightnessOffset: 0.045, surfaceChromaOffset: 0.006, weight: 0.8 },
  ],
}

/** “灰 + 主色”时底、面、墨、弱墨的彩度上限：几乎中性，只留一丝本色。 */
export const INK_RELATION_MAX_CHROMA = 0.006

/**
 * 米色带：这一段色相的浅色调读作米色、奶油色，是基准里反复出现的默认底色（用户要求染纸“不要米白”）。
 * 染纸底的主色避开这一段（灰 + 主色的底几乎无彩，不受影响）；没有别的本色时不出染纸底。
 */
export const BEIGE_HUES: RangeValue = { min: 45, max: 100 }

/**
 * 色调（借鉴日本色研 PCCS 的色调体系）：点题色与图表的“鲜浊深浅”。明度用 OKLCH，彩度用相对彩度
 * （彩度 ÷ 该明度色相下 sRGB 的最大彩度），不同色相的同一档看起来一样鲜。`native` 是本色自己的色调。
 * 浅底与染纸（paper）上点题要够深，深底（dark）上要够浅，两边各有一套。
 */
export interface ToneSpec {
  readonly lightness: RangeValue
  readonly relativeChroma: RangeValue
  /** 绝对彩度上限：高彩度只给小面积角色。 */
  readonly maxChroma: number
  readonly weight: number
}

export type ToneSurface = 'paper' | 'dark'

export const ACCENT_TONES: Readonly<Record<ToneSurface, Readonly<Partial<Record<PaletteTone, ToneSpec>>>>> = {
  paper: {
    native: { lightness: { min: 0.3, max: 0.62 }, relativeChroma: { min: 0, max: 1 }, maxChroma: 0.15, weight: 1 },
    soft: { lightness: { min: 0.56, max: 0.64 }, relativeChroma: { min: 0.3, max: 0.42 }, maxChroma: 0.12, weight: 0.9 },
    dull: { lightness: { min: 0.46, max: 0.54 }, relativeChroma: { min: 0.26, max: 0.38 }, maxChroma: 0.11, weight: 0.9 },
    deep: { lightness: { min: 0.36, max: 0.45 }, relativeChroma: { min: 0.55, max: 0.75 }, maxChroma: 0.15, weight: 1 },
    dark: { lightness: { min: 0.27, max: 0.34 }, relativeChroma: { min: 0.35, max: 0.55 }, maxChroma: 0.1, weight: 0.6 },
    strong: { lightness: { min: 0.5, max: 0.58 }, relativeChroma: { min: 0.7, max: 0.9 }, maxChroma: 0.19, weight: 0.45 },
    grayish: { lightness: { min: 0.46, max: 0.56 }, relativeChroma: { min: 0.2, max: 0.3 }, maxChroma: 0.06, weight: 0.4 },
  },
  dark: {
    native: { lightness: { min: 0.68, max: 0.8 }, relativeChroma: { min: 0, max: 1 }, maxChroma: 0.15, weight: 1 },
    light: { lightness: { min: 0.78, max: 0.85 }, relativeChroma: { min: 0.4, max: 0.6 }, maxChroma: 0.12, weight: 0.9 },
    soft: { lightness: { min: 0.7, max: 0.77 }, relativeChroma: { min: 0.3, max: 0.45 }, maxChroma: 0.11, weight: 1 },
    bright: { lightness: { min: 0.74, max: 0.82 }, relativeChroma: { min: 0.7, max: 0.9 }, maxChroma: 0.19, weight: 0.45 },
    grayish: { lightness: { min: 0.7, max: 0.78 }, relativeChroma: { min: 0.2, max: 0.3 }, maxChroma: 0.06, weight: 0.4 },
  },
}

/** 点题色的最低彩度：再灰就读成文字，不像强调色（“灰”色调也不低于它）。 */
export const ACCENT_MIN_CHROMA = 0.035
/** `native` 色调下本色彩度的夹取区间：太灰的本色点题会读成文字。 */
export const NATIVE_ACCENT_CHROMA: RangeValue = { min: 0.045, max: 0.15 }
/** `native` 色调在深底上相对本色提亮的明度。 */
export const NATIVE_DARK_LIGHTNESS_LIFT = 0.22
export const ACCENT_LIGHTNESS_JITTER = 0.04
export const ACCENT_CHROMA_JITTER = 0.1

/** 点题色落入排除区时沿色相轴移到最近的允许色相，移动超过这个角度就放弃该候选。 */
export const MAX_ACCENT_HUE_SHIFT = 30

// —— 图表 ——

export const CHART_SERIES_COUNT = 5
/** 图表系列首尾明度（浅底从深到浅，深底从浅到深），各端在区间里随机取。 */
export const CHART_LIGHTNESS: Readonly<Record<ToneSurface, { readonly start: RangeValue; readonly end: RangeValue }>> = {
  paper: { start: { min: 0.36, max: 0.5 }, end: { min: 0.82, max: 0.92 } },
  dark: { start: { min: 0.82, max: 0.9 }, end: { min: 0.42, max: 0.55 } },
}
/** 图表首尾明度至少相差这么多，系列才按深浅读得出顺序。 */
export const CHART_MIN_LIGHTNESS_SPAN = 0.32
/** 深底上图表最暗一档至少比底色亮这么多。 */
export const CHART_DARK_GROUND_GAP = 0.2
/** 图表首色的相对彩度（由色调给出，再夹进这个区间）与绝对彩度上限。 */
export const CHART_RELATIVE_CHROMA: RangeValue = { min: 0.15, max: 0.6 }
export const CHART_MAX_CHROMA = 0.14
/** 图表末色的绝对彩度上限占首色上限的比例：浅端保持低饱和，不出亮薄荷、亮青这类糖果色。 */
export const CHART_END_MAX_CHROMA_RATIO = 0.5
/** 图表末色保留首色相对彩度的比例。 */
export const CHART_CHROMA_TAPER: RangeValue = { min: 0.45, max: 0.8 }
/** 同色系图表的色相漂移（Cubehelix 的思路：明度单调，色相沿途缓慢转动）；有一定概率不漂移。 */
export const CHART_HUE_DRIFT: RangeValue = { min: 6, max: 18 }
export const CHART_NO_DRIFT_PROBABILITY = 0.4
/** 灰 + 主色图表里灰阶的彩度。 */
export const EMPHASIS_GRAY_CHROMA = 0.004

// —— 色相关系（借鉴 PCCS 按色相差分的配色类别）——
//
// 同色系（同一色相）、灰 + 主色、邻近色（类似色相）、中差色、对照色、图片多色（三种以上图片色同一色调）。
// 补色（对侧 150°–210°）不用：用户明确不要“相反色同框”，由排除区保证。

/** 邻近色、中差色、对照色与主色的色相差。对照色上限留出排除区余量。 */
export const RELATION_HUE_SHIFT: Readonly<Record<'analog' | 'medium' | 'contrast', RangeValue>> = {
  analog: { min: 25, max: 50 },
  medium: { min: 60, max: 105 },
  contrast: { min: 110, max: 144 },
}
/**
 * 合成（图片里没有）的对照色最多离主色这么远。再远就接近补色，例如黄绿配蓝紫，用户读作相反色；
 * 128°–144° 只用图片里真有的颜色。
 */
export const SYNTHESIZED_HUE_SHIFT_MAX = 128
/**
 * 至少给了这么多张图时，只在一张图里出现的本色只做搭配色、不当主色：多半是某张图的背景或灯光，
 * 例如光合作用主图背景的暗红，整套铺成暗红就离题了。点缀色同样只做搭配色。
 */
export const PRIMARY_MIN_IMAGES_FOR_PRESENCE = 3
/** 色相差落在对应区间里的图片色优先当搭配色（图片里真有的颜色），没有才按色相差合成。 */
export const IMAGE_PARTNER_PROBABILITY = 0.75
/** 图片多色至少要几种本色；一套最多用几种（主色加两种，三色搭配最常见，再多容易花）。 */
export const MULTI_MIN_SUBJECTS = 3
export const MULTI_MAX_HUES = 3
/** 选哪种本色当主色：按本色排名的权重，第一种最常用，其余也有机会（每次主色不同，色系才不同）。 */
export const PRIMARY_SUBJECT_WEIGHTS: readonly number[] = [1, 0.55, 0.4, 0.3, 0.25]

/** 关系 × 底色的先验权重：只决定采样频率。同色系与灰 + 主色要有，但不能占多数。 */
export const RELATION_WEIGHTS: Readonly<Record<PaletteRelation, Readonly<Record<PaletteBase, number>>>> = {
  mono: { light: 0.5, tint: 0.8, dark: 0.6 },
  ink: { light: 0.8, tint: 0.4, dark: 0.6 },
  analog: { light: 0.7, tint: 0.7, dark: 0.6 },
  medium: { light: 0.9, tint: 0.8, dark: 0.8 },
  contrast: { light: 0.7, tint: 0.6, dark: 0.7 },
  multi: { light: 1, tint: 0.8, dark: 0.9 },
}

// —— 强调色数量 ——

/** 每种关系默认给几个强调色；调用方可以指定 1–6 个（PowerPoint 主题色有 accent1–accent6 六个槽位）。 */
export const DEFAULT_ACCENT_COUNT: Readonly<Record<PaletteRelation, number>> = {
  mono: 3,
  ink: 2,
  analog: 3,
  medium: 3,
  contrast: 3,
  multi: 4,
}
export const MAX_ACCENT_COUNT = 6
/** 强调色彼此至少相差的 ΔEOK；太近时沿明度拉开。 */
export const ACCENT_MIN_SEPARATION = 0.07
/**
 * 不同色相的强调色之间，色相差在 OKLab 里至少要有这么大（ΔH = 2√(c₁c₂)·sin(Δh/2)），否则一眼看上去是同一种颜色：
 * 例如灰绿配灰青，色相差 40° 但彩度只有 0.04，看起来仍是一种灰绿。达不到的候选丢掉。
 */
export const PARTNER_MIN_HUE_DIFFERENCE = 0.035
/** 同一色相的第二、三个强调色与前一个的明度差（tone-on-tone：同色相、明度拉开）。 */
export const ACCENT_TONE_STEP: RangeValue = { min: 0.1, max: 0.16 }

// —— 评分 ——

/**
 * 暗黄绿：色彩偏好研究里普遍不受欢迎（Palmer、Schloss 2010；Material 的 DislikeAnalyzer 同据）。
 * Material 的阈值是 HCT 色相 90–111、彩度 > 16、色调 < 65，这里换算到 OKLCH。
 */
export const DISLIKED_HUES: RangeValue = { min: 95, max: 120 }
export const DISLIKED_MIN_CHROMA = 0.045
export const DISLIKED_MAX_LIGHTNESS = 0.69
/** 点题、底、面落入暗黄绿时的分数系数；图表按落入的比例折算。 */
export const DISLIKED_ROLE_FACTOR = 0.35
export const DISLIKED_CHART_FACTOR = 0.5
/** 点题与墨太近会读成文字。 */
export const ACCENT_INK_MIN_DISTANCE = 0.1
export const ACCENT_TOO_CLOSE_FACTOR = 0.5
/** 图表相邻两档太近分不清（O'Donovan 2011：配色里的颜色不能太相似）。 */
export const CHART_MIN_STEP_DISTANCE = 0.04
export const CHART_TOO_CLOSE_FACTOR = 0.6
/** 三种以上色系又都很鲜，就是用户否掉的“彩虹色”；多色系要靠统一的低彩色调收住。 */
export const RAINBOW_MIN_FAMILIES = 3
export const RAINBOW_MEAN_CHROMA = 0.1
export const RAINBOW_FACTOR = 0.5
/** 底色有明显彩度时点题再用高彩度，整页太“吵”。 */
export const LOUD_BG_CHROMA = 0.02
export const LOUD_ACCENT_CHROMA = 0.15
export const LOUD_FACTOR = 0.6

// —— 挑选 ——

/** 每次采样的候选数。 */
export const CANDIDATE_COUNT = 240
/**
 * 挑选：每套与已选各套的距离至少为门槛（O'Donovan 2011 给多条建议的做法），门槛从高到低放宽；
 * 满足门槛的候选里先只看没用过的关系，再在分数不低于最高分这个比例的里按分数加权随机抽一套。
 * 距离以“色系组合”为主（一眼看过去是不是同一类颜色），见 scorePalette.paletteDistance。
 */
export const MIN_PALETTE_DISTANCES: readonly number[] = [0.7, 0.55, 0.4, 0.25, 0.1, 0]
export const QUALITY_BAND = 0.75
/**
 * 感知距离里各角色的权重（ΔEOK 加权平均）。墨与弱墨几乎总是深灰或浅灰，权重大了会把差异稀释掉；
 * 看一套配色时先看到的是纸、点题和图表。
 */
export const DISTANCE_WEIGHTS = { bg: 0.75, surface: 0.25, ink: 0.125, muted: 0.125, accent: 1, chart: 1 } as const
/** 距离 = 色系组合的 Jaccard 距离 + 底色明暗不同的加项 + 颜色差（角色加权 ΔEOK）× 系数。 */
export const FAMILY_DISTANCE_WEIGHT = 1
export const BASE_DISTANCE = 0.25
export const COLOR_DISTANCE_WEIGHT = 0.5
/** 低于这个彩度的颜色不算色系（中性）；底色彩度达到 TINTED_BG_CHROMA 才把底的色系算进去。 */
export const FAMILY_MIN_CHROMA = 0.03
export const TINTED_BG_CHROMA = 0.012

export const DEFAULT_PALETTE_COUNT = 3
export const MAX_PALETTE_COUNT = 5
