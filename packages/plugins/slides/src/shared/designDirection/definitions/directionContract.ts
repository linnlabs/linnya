import * as z from 'zod';
import type { CoverCompositionId } from './coverComposition';

/**
 * 新建整稿时由程序发出的视觉方向（设计签）合同。
 *
 * 签只规定“用什么方法表达”：手法、配色逻辑、色相区间、字体策略、图片策略与一个内容母题。
 * 具体颜色值、字体、母题画法与构图由 Agent 根据内容决定，再以 `theme.direction`
 * 声明回 deck.js，供 inspect 逐页对照背景、字体与颜色是否贯彻。
 */

export const DIRECTION_SCENARIOS = [
  'business',
  'teaching',
  'culture',
  'product',
  'academic',
  'personal',
] as const;
export type DirectionScenario = (typeof DIRECTION_SCENARIOS)[number];

export const DIRECTION_BOLDNESS = ['steady', 'balanced', 'bold'] as const;
export type DirectionBoldness = (typeof DIRECTION_BOLDNESS)[number];

export const DIRECTION_FAMILIES = [
  'info',
  'print',
  'archive',
  'industrial',
  'spatial',
  'science',
  'everyday',
  'art',
] as const;
export type DirectionFamily = (typeof DIRECTION_FAMILIES)[number];

export const COLOR_LOGIC_IDS = [
  'paper-ink',
  'white-signal',
  'mono-depth',
  'bw-signal',
  'dark-glow',
  'photo-sampled',
  'duotone-print',
  'primary-blocks',
  'pastel-field',
  'earth-tones',
] as const;
export type ColorLogicId = (typeof COLOR_LOGIC_IDS)[number];

export const TYPE_STRATEGY_IDS = [
  'heavy-sans',
  'book-serif',
  'mono-technical',
  'serif-sans-mix',
  'display-image',
  'numeral-hero',
  'calligraphy',
  'condensed-label',
] as const;
export type TypeStrategyId = (typeof TYPE_STRATEGY_IDS)[number];

export const IMAGE_STRATEGY_IDS = [
  'documentary-color',
  'archival-bw',
  'macro-detail',
  'diagram-only',
  'maps-plans',
  'cutout-objects',
  'generated-illustration',
  'typographic',
] as const;
export type ImageStrategyId = (typeof IMAGE_STRATEGY_IDS)[number];

/** 画面里基本没有图片的策略；稿子必须有图片时不发。 */
export const IMAGELESS_IMAGE_STRATEGY_IDS: readonly ImageStrategyId[] = ['diagram-only', 'typographic'];

/** 1 稳妥：正式汇报也不会出错；2 适中；3 大胆：适合展示与分享。 */
export type TechniqueBoldness = 1 | 2 | 3;

/** 每个场景的抽取权重：0 不进入该场景，3 最常用。 */
export type ScenarioWeights = Readonly<Partial<Record<DirectionScenario, 0 | 1 | 2 | 3>>>;

export interface TechniqueCard {
  readonly id: string;
  readonly family: DirectionFamily;
  readonly name: string;
  /** 借用的是哪种成熟视觉体裁，一句话。 */
  readonly borrows: string;
  readonly scenarios: ScenarioWeights;
  readonly boldness: TechniqueBoldness;
  readonly colorLogics: readonly ColorLogicId[];
  readonly typeStrategies: readonly TypeStrategyId[];
  readonly imageStrategies: readonly ImageStrategyId[];
  /** 如何贯彻到封面、内页、图表、表格与页码。 */
  readonly apply: string;
  /** 这张卡最常见的失败。 */
  readonly pitfalls: string;
}

export interface DirectionAxisOption<TId extends string> {
  readonly id: TId;
  readonly name: string;
  readonly guide: string;
}

export interface HueBin {
  /** 0–11。 */
  readonly bin: number;
  /** OKLCH 色相区间（度），可跨 0°；只用来归档，不给 Agent 看。 */
  readonly from: number;
  readonly to: number;
  readonly name: string;
  /** 这一档的参考色（hex），深、中、浅各一个；Agent 据此理解“这个颜色大概什么样”。 */
  readonly references: readonly [string, string, string];
}

export interface DirectionDraw {
  readonly drawId: string;
  readonly seed: string;
  readonly poolVersion: string;
  readonly scenario: DirectionScenario;
  readonly boldness: DirectionBoldness;
  readonly card: TechniqueCard;
  readonly colorLogic: DirectionAxisOption<ColorLogicId>;
  /** 主色相区间；配色取自主图或纯黑白时为 null。 */
  readonly hue: HueBin | null;
  /** 给 Agent 的参考色：hue.references 里按稿随机取的一个；hue 为 null 时也为 null。 */
  readonly hueReference: string | null;
  /** 主色相对面的几档（色相差 150°–210° 覆盖过半的档），本稿不用；hue 为 null 时为空。 */
  readonly oppositeHues: readonly HueBin[];
  readonly typeStrategy: DirectionAxisOption<TypeStrategyId>;
  readonly imageStrategy: DirectionAxisOption<ImageStrategyId>;
  /** 封面的重心安排：标题与主体放在哪里。比例、裁切与元素仍由 Agent 按内容决定。 */
  readonly coverComposition: DirectionAxisOption<CoverCompositionId>;
  /** 从 Agent 提交的内容母题里挑出的那一个；没有提交母题时为 null。 */
  readonly motif: string | null;
}

export const DirectionMotifSchema = z.object({
  text: z.string().trim().min(1).max(80),
  /** 0–1：这个母题在同类稿子里有多常见。越常见越不容易被挑中。 */
  typicality: z.number().min(0).max(1),
}).strict();
export type DirectionMotif = z.infer<typeof DirectionMotifSchema>;

export const DirectionDrawRequestSchema = z.object({
  scenario: z.enum(DIRECTION_SCENARIOS),
  boldness: z.enum(DIRECTION_BOLDNESS).optional(),
  motifs: z.array(DirectionMotifSchema).min(3).max(12),
  /** 用户要求配图，或内容离不开图片（器物、人物、现场、实验）时为 true：不发“只用图解”“以字为画”。 */
  requireImages: z.boolean().optional(),
  /** 基准与复现专用；正常调用不传，由程序取随机种子。 */
  seed: z.string().trim().min(1).max(64).optional(),
  /** 上一次发出的手法确实不适合这份内容时，写明理由退回，程序换一张。 */
  rejected: z.array(z.object({
    cardId: z.string().trim().min(1).max(80),
    reason: z.string().trim().min(4).max(200),
  }).strict()).max(5).optional(),
}).strict();
export type DirectionDrawRequest = z.infer<typeof DirectionDrawRequestSchema>;

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/u, '颜色必须是 #RRGGBB');

/** 全稿用到的底色、正文墨色与强调色；计划卡展示它，deck.js 在 theme.direction 里照抄。 */
export const DirectionPaletteSchema = z.object({
  /** 页面背景色；第二个起可以是封面、章节页使用的反色底。 */
  backgrounds: z.array(HexColorSchema).min(1).max(4),
  ink: HexColorSchema,
  /** 次要文字色。 */
  muted: HexColorSchema.optional(),
  accents: z.array(HexColorSchema).min(1).max(6),
  /** 图表系列色；不写时图表色从 accents 取。 */
  chart: z.array(HexColorSchema).min(1).max(8).optional(),
}).strict();
export type DirectionPalette = z.infer<typeof DirectionPaletteSchema>;

const DirectionHueSchema = z.number().min(0).max(360);

/**
 * 全稿配色的来源：取自 `linnya palette suggest` 时写套的编号和排除色相（OKLCH 度数，起止可跨 0°）；
 * 图里取不出颜色或本稿最后没用照片时写明原因。inspect 用它检查排除色相，并找出有照片却没取色的稿子。
 */
export const DirectionImagePaletteSchema = z.union([
  z.object({
    id: z.string().trim().min(1).max(80),
    excludedHues: z.array(z.tuple([DirectionHueSchema, DirectionHueSchema])).max(12),
  }).strict(),
  z.object({ unavailable: z.enum(['no_subject_color', 'no_photos']) }).strict(),
]);
export type DirectionImagePalette = z.infer<typeof DirectionImagePaletteSchema>;

/** 全稿允许出现的字体族（PPTX 中可见的字体名）。 */
export const DirectionFontsSchema = z.array(z.string().trim().min(1)).min(1).max(6);

/**
 * deck.js 在 `compose({ theme: { direction } })` 里声明的方向。
 *
 * 它是可检查的声明，不替代 theme 的颜色与字体；inspect 用它逐页对照背景、字体与颜色。
 */
export const DirectionDeclarationSchema = z.object({
  drawId: z.string().trim().min(1).max(80),
  cardId: z.string().trim().min(1).max(80),
  palette: DirectionPaletteSchema,
  imagePalette: DirectionImagePaletteSchema.optional(),
  fonts: DirectionFontsSchema,
}).strict();
export type DirectionDeclaration = z.infer<typeof DirectionDeclarationSchema>;
