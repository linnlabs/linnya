import type {
  RenderInlineRun,
  RenderParagraph,
  RenderTextRun,
} from '../../renderModel';
import type { MathFormulaRenderProjection } from '../../mathFormula';
import type { TextLayoutContract } from './contract';

/**
 * 一行内属于同一个 run 的连续文本切片。所有坐标为文本框内容区内的英寸值。
 * 当单个字形宽于内容区时，居中/右对齐会产生负 x，让字形按 PowerPoint 语义进入 padding 区域。
 */
export interface RenderLineSlice {
  kind?: 'text';
  paragraphIndex: number;
  runIndex: number;
  text: string;
  x: number;
  width: number;
  /** 字形顶部 y（文本框内容区坐标），由共享布局引擎按共同 baseline 计算。 */
  textY: number;
  /** bullet marker 由布局引擎插入，前端需要按普通 slice 画但不参与原文拼接。 */
  isBulletMarker?: boolean;
}

export interface InlineBoxLineSlice {
  kind: 'inlineBox';
  paragraphIndex: number;
  runIndex: number;
  identity: string;
  projection: MathFormulaRenderProjection;
  x: number;
  width: number;
  /** 行框内公式 ink 顶部坐标，单位英寸。 */
  boxY: number;
  height: number;
}

export type RenderInlineLineSlice = RenderLineSlice | InlineBoxLineSlice;

export interface RenderTextLine {
  paragraphIndex: number;
  slices: RenderInlineLineSlice[];
  /** 行框顶部 y（文本框内容区内坐标） */
  y: number;
  /** 基线相对行框顶部的偏移 */
  baseline: number;
  height: number;
  /** 文本本身占用的宽度（含段落缩进，不含对齐偏移） */
  width: number;
  align: NonNullable<RenderParagraph['align']>;
}

export interface TextLayoutResult {
  lines: RenderTextLine[];
  contentHeightInches: number;
  /** resize-shape 所需外框高度（内容高度 + 上下 padding），单位 = inches。 */
  requiredHeightInches?: number;
  /** normAutofit 实际应用的字号缩放（1 = 未缩放） */
  appliedFontScale: number;
  /** 行距缩减量（M3 前恒为 0） */
  appliedLineSpacingReduction: number;
  /** 断行 advance 来源，用于观察与回归分档 */
  advanceSource: 'pretext' | 'heuristic' | 'harfbuzz';
  /** 布局引擎检测到的真实溢出事实；renderer 只执行 clip，不再自行猜测。 */
  overflow: {
    horizontal: boolean;
    vertical: boolean;
    hiddenLineCount: number;
  };
}

export interface RunAdvanceMeasureResult {
  advances: readonly number[];
  source: TextLayoutResult['advanceSource'];
}

export interface RunMeasureStyle {
  fontFamily: string;
  fontSizePt: number;
  bold: boolean;
  italic: boolean;
  /** 当前 run 文本，供 backend 字体 metrics 解析复用同一份 cmap 覆盖事实。 */
  text?: string;
  letterSpacingPt?: number;
  script?: 'latin' | 'eastAsian' | 'complex';
}

/** 平台测量能力实现此 port；引擎只认它，不认 TextMeasureService。 */
export interface RunAdvanceProvider {
  /**
   * 返回与 clusters 一一对应的 advance（英寸）。
   * clusters 由引擎用同一套 grapheme 切分产出，保证测量与断行同源。
   */
  getClusterAdvances(clusters: readonly string[], style: RunMeasureStyle): RunAdvanceMeasureResult;
}

export interface FontLineMetrics {
  /** baseline 上方高度，单位 = inches。 */
  ascent: number;
  /** baseline 下方高度，单位 = inches，恒为正数。 */
  descent: number;
  /** 行内额外 gap，单位 = inches。 */
  lineGap: number;
}

/** 字体度量 provider 只暴露行布局需要的窄口，不泄漏 FontCatalog。 */
export interface FontMetricsProvider {
  getMetrics(style: RunMeasureStyle): FontLineMetrics | undefined;
}

export interface TextLayoutInput {
  paragraphs: readonly RenderParagraph[];
  /** M2 Task 2.0 产出的唯一布局语义来源。 */
  contract: TextLayoutContract;
  defaultFontFamily: string;
}

export type TextRunStyleResolver = (run: RenderTextRun) => RunMeasureStyle;

export function isRenderTextRun(run: RenderInlineRun): run is RenderTextRun {
  return !('kind' in run && run.kind === 'formula');
}
