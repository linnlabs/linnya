import * as z from 'zod';

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
  /** 0–11，每档 30°。 */
  readonly bin: number;
  readonly from: number;
  readonly to: number;
  readonly name: string;
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
  readonly typeStrategy: DirectionAxisOption<TypeStrategyId>;
  readonly imageStrategy: DirectionAxisOption<ImageStrategyId>;
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

/**
 * deck.js 在 `compose({ theme: { direction } })` 里声明的方向。
 *
 * 它是可检查的声明，不替代 theme 的颜色与字体；inspect 用它逐页对照背景、字体与颜色。
 */
export const DirectionDeclarationSchema = z.object({
  drawId: z.string().trim().min(1).max(80),
  cardId: z.string().trim().min(1).max(80),
  palette: z.object({
    /** 页面背景色；第二个起可以是封面、章节页使用的反色底。 */
    backgrounds: z.array(HexColorSchema).min(1).max(4),
    ink: HexColorSchema,
    accents: z.array(HexColorSchema).min(1).max(5),
  }).strict(),
  /** 全稿允许出现的字体族（PPTX 中可见的字体名）。 */
  fonts: z.array(z.string().trim().min(1)).min(1).max(6),
}).strict();
export type DirectionDeclaration = z.infer<typeof DirectionDeclarationSchema>;
