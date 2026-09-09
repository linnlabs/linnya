/**
 * PresentationRenderModel — Slides 插件前后端共享的渲染协议
 *
 * 定义 Konva 渲染层消费的完整数据模型。
 * 这是 backend render mapper -> renderer slides store -> Konva stage 的正式接口，
 * 不是 renderer-only UI state，也不是轻量 DeckPreview 的替代品。
 *
 * 与 DeckPreview 的区别：
 * - DeckPreview 只携带结构概要（元素类型、纯文本、位置）
 * - PresentationRenderModel 携带完整视觉事实（样式、填充、字体、表格单元格、图表数据等）
 *
 * 坐标系统：
 * - 所有几何值使用英寸（inches），与 PPTX / DeckSpec 对齐
 * - 前端渲染层负责 inches -> canvas px 的转换
 */

import type { PresentationSourceKind } from '../documentSource';
import type { GeneratedLayoutConstraintEvidence } from '../generatedLayoutConstraints';
import type { MathFormulaMetrics, MathFormulaRenderProjection } from '../mathFormula';
import type { RenderSlideSizeInches } from '../deckSpec';
import type { ResolvedShapeGeometry } from '../shapeGeometry';
import type { SvgGraphicFit, SvgGraphicViewBox } from '../svgGraphic';
import type {
  TextLineSpacing,
  TextLineSpacingResolution,
} from '../textLayout/definitions/lineSpacing';
import type { TextLayoutResult } from '../textLayout/definitions/types';
import type {
  TextFontFaceFingerprint,
  TextFontResolutionKind,
  TextFontScript,
} from '../textFontIdentity';
import type {
  GradientPaint,
  NoPaint,
  Paint,
  SolidPaint,
  StrokePaint,
} from '../visual/paint';

// ─── 顶层模型 ──────────────────────────────────────────────────────────────

/** 演示文稿的完整渲染模型 */
export interface PresentationRenderModel {
  presentationId: string;
  title: string;
  version: number;
  sourceKind: PresentationSourceKind;
  slideSize: RenderSlideSize;
  slides: SlideRenderModel[];
  capabilities: RenderCapabilities;
}

export type RenderSlideSize = RenderSlideSizeInches;

/** 渲染能力标记：前端据此决定使用哪条渲染路径 */
export interface RenderCapabilities {
  /** 是否携带完整语义渲染数据（text runs / fills / strokes 等） */
  hasSemanticRender: boolean;
  /** 是否携带参考预览图（imported deck 的高保真快照） */
  hasReferencePreview: boolean;
  /** 是否支持元素级命中测试 */
  hasHitTest: boolean;
  /** 是否支持元素级选中 */
  hasSelection: boolean;
  /** 是否支持“选中元素 → 精确源码片段 → AI 编辑”的源码选区链路 */
  canEditSourceSelection?: boolean;
}

// ─── 单页模型 ──────────────────────────────────────────────────────────────

export interface SlideRenderModel {
  slideId: string;
  index: number;
  layoutKey: string;
  background: SlideBackgroundModel;
  elements: RenderNode[];
  /** 页级诊断摘要（FE-K4 使用） */
  diagnostics?: SlideDiagnosticsSummary;
  /** imported deck 的参考预览（FE-K6 使用） */
  referencePreview?: SlideReferencePreview;
}

// ─── 背景 ──────────────────────────────────────────────────────────────────

export interface SlideBackgroundModel {
  /** 背景视觉事实；纯色与渐变走同一条渲染链。 */
  paint: Paint;
  /** 背景图片 URL / data URI */
  imageSrc?: string;
  /** 背景图片适应模式 */
  imageFit?: 'cover' | 'contain' | 'stretch' | 'tile';
}

/** @deprecated 渐变已直接使用共享 GradientPaint。 */
export type SlideBackgroundGradientModel = GradientPaint;

// ─── 诊断摘要 ──────────────────────────────────────────────────────────────

export interface SlideDiagnosticsSummary {
  warningCount: number;
  errorCount: number;
  /** 诊断项 ID 列表，与 RenderNode.diagnosticsRefIds 关联 */
  diagnosticIds: string[];
}

// ─── 参考预览 ──────────────────────────────────────────────────────────────

export interface SlideReferencePreview {
  kind: 'image' | 'pdf-page' | 'none';
  src?: string;
  width?: number;
  height?: number;
  generatedAt?: string;
}

// ─── 编辑目标 ──────────────────────────────────────────────────────────────

export type EditableOperation =
  | 'modify_text'
  | 'edit_image'
  | 'update_chart'
  | 'update_table'
  | 'modify_style'
  | 'modify_geometry'
  | 'reorder_layer'
  | 'relayout_slide';

/** 该元素支持的语义重排意图类型（仅 relayout_slide 时有意义） */
export type RelayoutCapability =
  | 'promote'
  | 'demote'
  | 'expand'
  | 'shrink'
  | 'swap_primary'
  | 'move_to_region';

export interface EditableTarget {
  slideNumber?: number;
  elementId?: string;
  creationId?: string;
  elementName?: string;
  /** canonical node ID（如 'headline', 'chart', 'evidence-0'），仅 generated deck */
  semanticNodeId?: string;
  /** 语义角色（如 'primary-visual', 'claim'），仅 generated deck */
  semanticRole?: string;
  operations: EditableOperation[];
  imageEditCapabilities?: {
    replaceSource: boolean;
    editVisuals: boolean;
  };
  /** 该元素支持的语义重排意图（仅当 operations 包含 relayout_slide 时有意义） */
  relayoutCapabilities?: RelayoutCapability[];
}

// ─── 渲染节点 ──────────────────────────────────────────────────────────────

export type RenderNodeKind =
  | 'text'
  | 'shape'
  | 'image'
  | 'svgGraphic'
  | 'formula'
  | 'table'
  | 'chart'
  | 'group';

/** 位置与尺寸（英寸） */
export interface RenderBox {
  x: number;
  y: number;
  w: number;
  h: number;
  unit: 'in';
}

/** deck.js 源码行号定位，1-based，闭区间。 */
export interface RenderSourceSpan {
  startLine: number;
  endLine: number;
}

/** 通用节点基类字段 */
export interface RenderNodeBase {
  id: string;
  kind: RenderNodeKind;
  box: RenderBox;
  editableTarget?: EditableTarget;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  zIndex: number;
  locked?: boolean;
  interactive?: boolean;
  /** 该节点对应的 deck.js 工厂调用源码行号；仅 codegen-ready generated deck 具备 */
  sourceSpan?: RenderSourceSpan;
  /** Flex/Yoga 编译后的窄约束事实；Renderer 不参与解释。 */
  layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
  /** 关联的诊断项 ID，用于 overlay 高亮 */
  diagnosticsRefIds?: string[];
}

/** 联合节点类型 */
export type RenderNode =
  | TextRenderNode
  | ShapeRenderNode
  | ImageRenderNode
  | SvgGraphicRenderNode
  | MathFormulaRenderNode
  | TableRenderNode
  | ChartRenderNode
  | GroupRenderNode;

// ─── 文本节点 ──────────────────────────────────────────────────────────────

export interface TextRenderNode extends RenderNodeBase {
  kind: 'text';
  paragraphs: RenderParagraph[];
  /** 文本框级垂直对齐 */
  verticalAlign?: 'top' | 'middle' | 'bottom';
  /** 文本换行策略 */
  wrap?: 'word' | 'char' | 'none';
  /** 溢出处理 */
  overflow?: 'clip' | 'ellipsis' | 'visible';
  /** 自动缩放策略 */
  autoFitPolicy?: 'none' | 'shrink-text' | 'resize-shape';
  /** 文本框内边距（英寸） */
  padding?: RenderPadding;
  /**
   * 由后端 LineLayoutEngine 产出的行级布局结果。
   * 存在时前端必须逐行绘制，禁止再让 Konva 自行软换行。
   */
  layout?: TextLayoutResult;
}

export interface RenderParagraph {
  runs: RenderInlineRun[];
  align?: 'left' | 'center' | 'right' | 'justify';
  /** 段落级行距语义；M3 后它是布局主链的唯一行距权威。 */
  lineSpacing?: RenderLineSpacing;
  /** imported 继承解析的可观察来源；布局仍只消费 lineSpacing。 */
  lineSpacingResolution?: TextLineSpacingResolution;
  /** 段前间距（pt） */
  spacingBefore?: number;
  /** 段后间距（pt） */
  spacingAfter?: number;
  /** 首行缩进（英寸） */
  indent?: number;
  /** 项目符号 */
  bullet?: RenderBullet;
}

export interface RenderFormulaRun {
  kind: 'formula';
  projection: MathFormulaRenderProjection;
}

export type RenderInlineRun = RenderTextRun | RenderFormulaRun;

export interface RenderTextRun {
  text: string;
  /** 原始字体声明，必须保留给 PPTX 导出/编辑语义。 */
  fontFamily?: string;
  /** 后端字体解析后的系统字体声明，测量和预览优先使用它。 */
  resolvedFontFamily?: string;
  /** 平台字体解析使用的主导脚本和解析终态，供诊断复用，禁止下游重新猜 family。 */
  fontScript?: TextFontScript;
  fontResolution?: TextFontResolutionKind;
  /** 实际命中字体文件/face 的安全指纹；不得替换为本机绝对路径。 */
  fontFaceFingerprint?: TextFontFaceFingerprint;
  /** 实际命中 face 的样式；测量和绘制必须优先于作者请求样式。 */
  resolvedFontWeight?: 'normal' | 'bold';
  resolvedFontStyle?: 'normal' | 'italic';
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  /** 字间距（pt） */
  letterSpacing?: number;
}

/** @deprecated 使用 TextLineSpacing；保留别名减少 RenderModel 消费方的无意义改名。 */
export type RenderLineSpacing = TextLineSpacing;

export interface RenderBullet {
  type: 'disc' | 'circle' | 'square' | 'decimal' | 'alpha' | 'roman' | 'custom';
  /** 自定义符号字符 */
  char?: string;
  /** 项目符号嵌套层级 */
  level?: number;
  color?: string;
  fontSize?: number;
}

// ─── 形状节点 ──────────────────────────────────────────────────────────────

export interface ShapeRenderNode extends RenderNodeBase {
  kind: 'shape';
  geometry: ResolvedShapeGeometry;
  fill?: RenderFill;
  stroke?: RenderStroke;
  /**
   * 圆角半径，单位 = 英寸（inches），与 PptxGenJS `rectRadius` 完全同义。
   *
   * 实现细节：
   *   - PptxGenJS 把它转成 OOXML adj：`(cornerRadius_in × 100000) / min(width_in, height_in)`，
   *     当 `cornerRadius_in ≥ short_side / 2` 时达到上限 50000 → 渲染为完美胶囊（pill）；
   *   - 前端 Konva 端按 `cornerRadius × 96 px`，再 cap 到 short_side / 2，与 PPT 严格一致。
   *
   * 典型值：0.04–0.12 英寸（≈ 4–12 px）；要做胶囊请显式写 `min(width, height) / 2`。
   */
  cornerRadius?: number;
  shadow?: RenderShadow;
  /** 形状内嵌文本 */
  innerText?: TextRenderNode;
}

// ─── 图片节点 ──────────────────────────────────────────────────────────────

export interface ImageRenderNode extends RenderNodeBase {
  kind: 'image';
  /** 图片来源引用 */
  assetRef: RenderAssetRef;
  /** 图片原始尺寸（px） */
  naturalSize?: { width: number; height: number };
  /** 图片适应模式 */
  fitMode?: 'fill' | 'contain' | 'cover' | 'stretch';
  /** 裁剪区域（0~1 归一化比例） */
  crop?: { top: number; right: number; bottom: number; left: number };
  maskShape?: 'rect' | 'circle';
  borderRadius?: number;
  shadow?: RenderShadow;
  alt?: string;
  flipH?: boolean;
  flipV?: boolean;
}

/** 只携带 Host 已授权读取、且通过唯一 admission 的 canonical SVG。 */
export interface SvgGraphicRenderNode extends RenderNodeBase {
  kind: 'svgGraphic';
  canonicalSvg: string;
  contentHash: string;
  viewBox: SvgGraphicViewBox;
  fit: SvgGraphicFit;
  altText?: string;
  decorative: boolean;
}

/** 公式前端投影；canonical AST 不进入 RenderModel。 */
export interface MathFormulaRenderNode extends RenderNodeBase {
  kind: 'formula';
  canonicalSvg: string;
  contentHash: string;
  viewBox: { x: number; y: number; width: number; height: number };
  contentViewBox: { x: number; y: number; width: number; height: number };
  metrics: MathFormulaMetrics;
  altText: string;
  align: 'left' | 'center' | 'right';
}

/** 统一资产引用 */
export type RenderAssetRef =
  | { type: 'embedded'; partPath: string }
  | { type: 'data'; dataUri: string }
  | { type: 'external'; url: string };

// ─── 表格节点 ──────────────────────────────────────────────────────────────

export interface TableRenderNode extends RenderNodeBase {
  kind: 'table';
  /** 列宽（英寸） */
  columns: number[];
  /** 行高（英寸） */
  rows: number[];
  cells: RenderTableCell[];
  /** 表格行语义：区分表头 / 表体 / 表尾 */
  headerRows?: number;
  footerRows?: number;
  /**
   * PptxGenJS 原始表格选项透传，供前端 Konva 渲染器近似模拟 PPT 视觉效果。
   */
  pptxHints?: TablePptxHints;
}

/**
 * 从 PptxGenJS ITableOptions 中透传的视觉关键选项。
 * 前端 KonvaTableNode 消费这些字段来微调渲染。
 */
export interface TablePptxHints {
  /** 表格整体背景色 */
  tableFill?: string;
  /** 表头背景色 */
  headerFill?: string;
  /** 旧 RenderModel 的内部边框颜色提示；新的 DeckSpec 使用 table.border。 */
  borderColor?: string;
}

/**
 * 表格视觉默认值（B8 三端共享契约 / CONTRACTS §2.5）：
 *
 * render-model（mapStructuredTableNode）/ compiler（StructuredCompiler.addTable）/ 前端
 * （tableBuilder.buildCellRectConfig）三端必须使用同一组默认色，避免预览与导出不一致。
 *
 * 历史上各端散落硬编码 `'#F2F2F2'` / `'F2F2F2'`，调整一处会漏掉别处；统一抽到此处。
 */
export const TABLE_DEFAULT_HEADER_FILL = '#F2F2F2';
export const TABLE_DEFAULT_BACKGROUND_FILL = '#FFFFFF';
export const TABLE_DEFAULT_CELL_PADDING: RenderPadding = {
  top: 0.08,
  right: 0.1,
  bottom: 0.08,
  left: 0.1,
};

export interface RenderTableCell {
  /** 行索引（从 0 开始） */
  row: number;
  /** 列索引（从 0 开始） */
  col: number;
  rowSpan?: number;
  colSpan?: number;
  /** 单元格内文本 */
  paragraphs: RenderParagraph[];
  fill?: string;
  /** 单元格边框 */
  borders?: RenderTableCellBorders;
  /** 单元格内边距（英寸） */
  padding?: RenderPadding;
  verticalAlign?: 'top' | 'middle' | 'bottom';
  /** 后端最终布局阶段产出的单元格文本 IR；renderer 不得自行测量。 */
  textLayout?: TextLayoutResult;
}

export interface RenderTableCellBorders {
  top?: RenderStroke;
  right?: RenderStroke;
  bottom?: RenderStroke;
  left?: RenderStroke;
}

// ─── 图表节点 ──────────────────────────────────────────────────────────────

/** PptxGenJS 图表标签、坐标轴与图例的默认字号（pt）。 */
export const CHART_DEFAULT_LABEL_FONT_SIZE_PT = 8;

export interface ChartRenderNode extends RenderNodeBase {
  kind: 'chart';
  chartType: RenderChartType;
  categories: string[];
  series: RenderChartSeries[];
  /** 颜色调色板（hex 数组） */
  palette: [string, ...string[]];
  axes?: RenderChartAxes;
  legend?: RenderChartLegend;
  dataLabels?: RenderChartDataLabels;
  gridlines?: RenderChartGridlines;
  /** 堆叠模式 */
  stacking?: 'none' | 'stacked' | 'percent';
  /** 标签样式兜底（优先使用 axes/legend/dataLabels 上的专属样式） */
  labelStyle?: RenderChartLabelStyle;
  /**
   * PptxGenJS 原始图表选项透传，供前端渲染引擎近似模拟 PPT 视觉效果。
   * 所有字段 optional，前端在无值时使用 PPT 近似默认值。
   */
  pptxHints?: ChartPptxHints;
}

/**
 * 从 PptxGenJS IChartOpts 中透传的视觉关键选项。
 * 前端 ECharts mapper 消费这些字段来微调渲染，缩小与 PPT 的视觉差异。
 */
export interface ChartPptxHints {
  /** 柱间距百分比（PptxGenJS barGapWidthPct） */
  barGapWidthPct?: number;
  /** 柱重叠百分比（PptxGenJS barOverlapPct） */
  barOverlapPct?: number;
  /** 雷达图填充模式（PptxGenJS radarStyle） */
  radarStyle?: 'standard' | 'marker' | 'filled';
  /** 折线粗细 pt（PptxGenJS lineSize） */
  lineSize?: number;
  /** 折线平滑（PptxGenJS lineSmooth） */
  lineSmooth?: boolean;
  /** 环形图内孔百分比 0–100（PptxGenJS holeSize） */
  holeSize?: number;
  /** 类目轴方向（PptxGenJS catAxisOrientation） */
  catAxisOrientation?: 'minMax' | 'maxMin';
  /** 旧 RenderModel 的内部数据标签颜色提示；新的 DeckSpec 使用 chartStyle。 */
  dataLabelColor?: string;
}

export interface RenderChartLabelStyle {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
}

export type RenderChartType =
  | 'bar'
  | 'column'
  | 'line'
  | 'pie'
  | 'doughnut'
  | 'scatter'
  | 'area'
  | 'radar'
  | 'combo';

export interface RenderChartSeries {
  name: string;
  values: number[];
  /** combo 图表中此系列的图表类型 */
  chartType?: RenderChartType;
  color?: string;
}

export interface RenderChartAxes {
  x?: RenderChartAxis;
  y?: RenderChartAxis;
  y2?: RenderChartAxis;
}

export interface RenderChartAxis {
  title?: string;
  visible?: boolean;
  min?: number;
  max?: number;
  /** 刻度格式化（如 '%', '$', '0.0'） */
  format?: string;
  /** 轴标签样式 */
  labelStyle?: RenderChartLabelStyle;
}

export interface RenderChartLegend {
  visible?: boolean;
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** 图例标签样式 */
  labelStyle?: RenderChartLabelStyle;
}

export interface RenderChartDataLabels {
  visible?: boolean;
  format?: string;
  position?: 'inside' | 'outside' | 'center';
  /** 数据标签样式 */
  labelStyle?: RenderChartLabelStyle;
}

export interface RenderChartGridlines {
  x?: { visible?: boolean; color?: string };
  y?: { visible?: boolean; color?: string };
}

// ─── 分组节点 ──────────────────────────────────────────────────────────────

export interface GroupRenderNode extends RenderNodeBase {
  kind: 'group';
  children: RenderNode[];
}

// ─── 共享样式类型 ────────────────────────────────────────────────────────

export type RenderFill = Paint;
export type RenderSolidFill = SolidPaint;
export type RenderNoneFill = NoPaint;
export type RenderGradientFill = GradientPaint;

export interface RenderStroke {
  paint: StrokePaint;
  width: number;
  dash?: 'solid' | 'dash' | 'dot' | 'dashDot';
}

export interface RenderShadow {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
  opacity?: number;
}

export interface RenderPadding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}
