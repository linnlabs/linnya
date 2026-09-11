import type { ShapeGeometrySpec } from './shapeGeometry';
import type { BrushArtworkIntent, BrushArtworkSourceRef } from './brushArtwork';
import type { SlideLayout } from './deckSpec/slideSize';
import type {
  SvgGraphicAuthoringSource,
  SvgGraphicFit,
} from './svgGraphic';

export type LayoutDisplayValue = string | number | boolean;
export type LayoutTextAlign = 'left' | 'center' | 'right';
export type LayoutVerticalAlign = 'top' | 'middle' | 'bottom';

export type LayoutTextLineSpacingInput =
  | { kind: 'multiple'; value: number }
  | { kind: 'exactPt'; value: number };

export interface LayoutTextStyleInput {
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  align?: LayoutTextAlign;
  valign?: LayoutVerticalAlign;
  lineSpacing?: LayoutTextLineSpacingInput;
  /** 字间距，单位为 pt。 */
  letterSpacing?: number;
}

export interface LayoutPlainTextRun {
  text: string;
  style?: LayoutTextStyleInput;
}

export interface LayoutFormulaTextRun {
  formula: string | {
    latex: string;
    altText?: string;
  };
  style?: LayoutTextStyleInput;
}

export type LayoutTextRun = LayoutPlainTextRun | LayoutFormulaTextRun;

export type LayoutChartType =
  | 'bar'
  | 'line'
  | 'pie'
  | 'doughnut'
  | 'scatter'
  | 'area'
  | 'radar';

export type LayoutChartPresetName =
  | 'clean-column'
  | 'stacked-column'
  | 'horizontal-bar'
  | 'stacked-bar'
  | 'smooth-line'
  | 'straight-line'
  | 'area'
  | 'pie'
  | 'doughnut'
  | 'radar'
  | 'radar-filled'
  | 'scatter';

export type LayoutChartLegendPosition = 'top' | 'bottom' | 'left' | 'right' | 'none';

export interface LayoutChartSeriesInput {
  name: string;
  values: number[];
  labels?: LayoutDisplayValue[];
}

/**
 * 图表的跨引擎颜色语义。
 *
 * 这里只暴露前端预览和 PPTX 都能表达的稳定字段；不要把 ECharts
 * option 或 PptxGenJS 的原始配置直接放进 deck.js。
 */
export interface LayoutChartStyle {
  /** 图例文字颜色。 */
  legendColor?: string;
  /** 绘图区背景颜色。 */
  plotBackgroundColor?: string;
  /** 折线宽度，单位 pt，必须大于零。 */
  seriesLineWidth?: number;
  /** 类目轴和数值轴标签的共同兜底颜色。 */
  axisLabelColor?: string;
  /** 类目轴标签颜色，未提供时回退到 axisLabelColor。 */
  categoryAxisLabelColor?: string;
  /** 数值轴标签颜色，未提供时回退到 axisLabelColor。 */
  valueAxisLabelColor?: string;
  /** 数据标签颜色。 */
  dataLabelColor?: string;
  /** 类目网格线和数值网格线的共同颜色。 */
  gridlineColor?: string;
}

export interface LayoutTableCellInput {
  text: LayoutDisplayValue;
  style?: LayoutTextStyleInput;
  fill?: string;
  colspan?: number;
  rowspan?: number;
}

export interface LayoutTableBorderInput {
  color: string;
  /** 边框粗细，单位为 pt。 */
  width: number;
}

export type LayoutTableCellValue = LayoutDisplayValue | LayoutTableCellInput;

export interface LayoutImageVisualShadowInput {
  color?: string;
  blur?: number;
  angle?: number;
  distance?: number;
  opacity?: number;
}

export interface LayoutThemeInput {
  colors?: Record<string, string>;
  fonts?: {
    major: string;
    minor: string;
  };
  chart?: {
    palette: [string, ...string[]];
  };
}

export interface FlexProps {
  /** 正数 N 表示 grow=N、shrink=1、basis=0；无 flex 的显式主轴尺寸不收缩。 */
  flex?: number;
  width?: number | string;
  height?: number | string;
  /** width 的 PPT 风格别名。 */
  w?: number | string;
  /** height 的 PPT 风格别名。 */
  h?: number | string;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  margin?: number | EdgeInsets;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  position?: 'absolute' | AbsolutePositionBox;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  /** left 的 PPT 风格别名；出现坐标字段时自动使用绝对定位。 */
  x?: number;
  /** top 的 PPT 风格别名；出现坐标字段时自动使用绝对定位。 */
  y?: number;
}

export interface AbsolutePositionBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EdgeInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface LayoutSourceMetadata {
  readonly _sourceSpan?: {
    startLine: number;
    endLine: number;
  };
}

export interface LayoutBorderInput {
  color: string;
  width: number;
  dash?: 'solid' | 'dash' | 'dot';
}

export interface ContainerDecoration {
  backgroundColor?: string;
  border?: LayoutBorderInput;
  borderRadius?: number;
  opacity?: number;
}

export interface LayoutGradientStop {
  color: string;
  position: number;
  /** 0 表示透明，1 表示不透明。 */
  opacity?: number;
}

export type LayoutGradientDirection =
  | 'to-right' | 'to-bottom-right' | 'to-bottom' | 'to-bottom-left'
  | 'to-left' | 'to-top-left' | 'to-top' | 'to-top-right';

export type LayoutLinearGradient = {
  type: 'linear';
  stops: [LayoutGradientStop, LayoutGradientStop, ...LayoutGradientStop[]];
  rotateWithShape?: boolean;
} & (
  | {
    /** 0° 向右、90° 向下，顺时针；不同于 CSS。非正方形按 OOXML scaled 语义缩放方向。 */
    angle: number;
    direction?: never;
  }
  | {
    /** 语义方向，与 angle 二选一；日常创作优先使用。 */
    direction: LayoutGradientDirection;
    angle?: never;
  }
);

export interface LayoutRadialGradient {
  type: 'radial';
  stops: [LayoutGradientStop, LayoutGradientStop, ...LayoutGradientStop[]];
  center?: { x: number; y: number };
  radius?: { x: number; y: number };
  rotateWithShape?: boolean;
}

export type LayoutGradient = LayoutLinearGradient | LayoutRadialGradient;

export type LayoutShapeFillInput =
  | string
  | {
      color: string;
      /** 0 表示不透明，100 表示完全透明。 */
      transparency?: number;
    }
  | LayoutGradient;

export type LayoutShapeStroke =
  | {
      color: string;
      width: number;
      dash?: 'solid' | 'dash' | 'dot';
      paint?: never;
    }
  | {
      paint: LayoutLinearGradient;
      width: number;
      dash?: 'solid' | 'dash' | 'dot';
      color?: never;
    };

export type LayoutSlideBackground =
  | string
  | { color: string; image?: never; gradient?: never }
  | { image: LayoutImageSourceInput; color?: never; gradient?: never }
  | { gradient: LayoutGradient; color?: never; image?: never };

export interface LayoutSlideConfig extends FlexProps, ContainerDecoration {
  background?: LayoutSlideBackground;
  notes?: string;
}

export interface LayoutSlideNode extends LayoutSlideConfig, LayoutSourceMetadata {
  readonly _type: 'Slide';
  readonly children: readonly LayoutNode[];
}

export interface LayoutViewConfig extends FlexProps, ContainerDecoration {
  flexDirection?: 'column' | 'row';
  padding?: number | EdgeInsets;
  gap?: number;
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch';
  justifyContent?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around';
}

export interface LayoutViewNode extends LayoutViewConfig, LayoutSourceMetadata {
  readonly _type: 'View';
  readonly children: readonly LayoutNode[];
}

export type LayoutContainerNode = LayoutSlideNode | LayoutViewNode;

export type LayoutImageSourceRef =
  | { kind: 'external_url'; url: string }
  | { kind: 'data_uri'; dataUri: string }
  | { kind: 'local_path'; path: string }
  | { kind: 'generated_asset'; assetId: string }
  | BrushArtworkSourceRef;

export type LayoutImageSourceInput = LayoutImageSourceRef | string;

/** @deprecated 使用 LayoutViewNode + flexDirection: 'column'。 */
export type LayoutVStackNode = LayoutViewNode;
/** @deprecated 使用 LayoutViewNode + flexDirection: 'row'。 */
export type LayoutHStackNode = LayoutViewNode;

/**
 * Text 的横向约束决定换行语义：Flex 流中的 Text 或显式 width/maxWidth/左右边界
 * 使用固定盒宽并自动换行；绝对定位且没有横向约束时，盒宽跟随内容，只响应显式换行符。
 */
export interface LayoutTextConfig extends FlexProps {
  /** 页边辅助信息，不计入正文的字体层级与字体族数量。 */
  role?: 'footnote' | 'source' | 'page-number';
  content?: string | LayoutTextRun[];
  fontSize?: number;
  fontWeight?: 'bold' | 'normal' | number;
  fontStyle?: 'italic' | 'normal';
  textDecoration?: 'underline' | 'none';
  color?: string;
  fontFamily?: string;
  textAlign?: LayoutTextAlign;
  verticalAlign?: LayoutVerticalAlign;
  /** 行高倍数；富文本 run 的精确行距使用 style.lineSpacing。 */
  lineHeight?: number;
  /** 字间距，单位为 pt。 */
  letterSpacing?: number;
  backgroundColor?: string;
  border?: LayoutBorderInput;
  /** @deprecated 使用 fontWeight: 'bold'。 */
  bold?: boolean;
  /** @deprecated 使用 fontStyle: 'italic'。 */
  italic?: boolean;
  /** @deprecated 使用 textDecoration: 'underline'。 */
  underline?: boolean;
  /** @deprecated 使用 textAlign。 */
  align?: LayoutTextAlign;
  /** @deprecated 使用 verticalAlign。 */
  valign?: LayoutVerticalAlign;
  /** @deprecated 使用 lineHeight。 */
  lineSpacing?: number;
}

export interface LayoutTextNode extends LayoutTextConfig, LayoutSourceMetadata {
  readonly _type: 'Text';
}

export interface LayoutShapeConfig extends FlexProps {
  /** 声明背景或装饰意图，参与空间诊断；不改变无障碍语义。 */
  role?: 'background' | 'decoration';
  /** 允许超出画布的英寸数，默认零。 */
  bleed?: number;
  geometry?: ShapeGeometrySpec;
  fill?: LayoutShapeFillInput;
  border?: LayoutShapeStroke;
  borderRadius?: number;
  opacity?: number;
  rotate?: number;
  content?: string | LayoutPlainTextRun[];
}

export interface LayoutShapeNode extends LayoutShapeConfig, LayoutSourceMetadata {
  readonly _type: 'Shape';
}

export interface LayoutChartConfig extends FlexProps {
  preset?: LayoutChartPresetName;
  chartType?: LayoutChartType;
  categories?: LayoutDisplayValue[];
  series?: LayoutChartSeriesInput[];
  /** @deprecated 使用 chartType、categories 与 series。 */
  chartData?: LayoutChartDataLike;
  showDataLabels?: boolean;
  dataLabelFormat?: string;
  legendPosition?: LayoutChartLegendPosition;
  chartStyle?: LayoutChartStyle;
}

export interface LayoutChartNode extends LayoutChartConfig, LayoutSourceMetadata {
  readonly _type: 'Chart';
}

/** @deprecated 使用 chartType、categories 与 series。 */
export interface LayoutChartDataLike {
  chartType?: LayoutChartType;
  categories?: LayoutDisplayValue[];
  labels?: LayoutDisplayValue[];
  xLabels?: LayoutDisplayValue[];
  xAxisLabels?: LayoutDisplayValue[];
  series?: LayoutChartSeriesInput[];
  datasets?: LayoutChartSeriesInput[];
}

/** @deprecated 使用 headers 与 rows。 */
export interface LayoutTableDataLike {
  headers?: LayoutTableCellValue[];
  rows?: LayoutTableCellValue[][];
  body?: LayoutTableCellValue[][];
  data?: LayoutTableCellValue[][];
}

export interface LayoutTableConfig extends FlexProps {
  headers?: LayoutTableCellValue[];
  rows?: LayoutTableCellValue[][];
  /** 整张表四边及内部网格线的统一描边。 */
  border?: LayoutTableBorderInput;
  /** @deprecated 使用 headers 与 rows。 */
  tableData?: LayoutTableDataLike;
}

export interface LayoutTableNode extends LayoutTableConfig, LayoutSourceMetadata {
  readonly _type: 'Table';
}

export interface LayoutImageConfig extends FlexProps {
  role?: 'background' | 'decoration';
  /** 允许超出画布的英寸数，默认零。 */
  bleed?: number;
  src?: LayoutImageSourceInput;
  alt?: string;
  fitMode?: 'cover' | 'contain' | 'crop';
  maskShape?: 'rect' | 'circle';
  rounding?: boolean;
  /** 0 表示不透明，1 表示完全透明。 */
  transparency?: number;
  shadow?: LayoutImageVisualShadowInput;
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
}

export interface LayoutImageNode extends LayoutImageConfig, LayoutSourceMetadata {
  readonly _type: 'Image';
}

/** 受控声明式 Brush 绘制；运行时仍编译成普通 Image 节点。 */
export interface LayoutBrushArtworkConfig
  extends Omit<LayoutImageConfig, 'src'>, BrushArtworkIntent {}

export type LayoutSvgGraphicSourceInput = SvgGraphicAuthoringSource | string;

export interface LayoutSvgGraphicConfig extends FlexProps {
  source?: LayoutSvgGraphicSourceInput;
  fit?: SvgGraphicFit;
  opacity?: number;
  rotate?: number;
  /** decorative 不为 true 时必须提供非空替代文本。 */
  altText?: string;
  decorative?: boolean;
}

export interface LayoutSvgGraphicNode extends LayoutSvgGraphicConfig, LayoutSourceMetadata {
  readonly _type: 'SvgGraphic';
}

export interface LayoutFormulaConfig extends FlexProps {
  /** 受控 LaTeX profile；不支持的命令会直接报错。 */
  latex: string;
  /** PowerPoint 原生公式字号，单位 pt。 */
  fontSize?: number;
  /** #RRGGBB。 */
  color?: string;
  align?: 'left' | 'center' | 'right';
  altText?: string;
}

export interface LayoutFormulaNode extends LayoutFormulaConfig, LayoutSourceMetadata {
  readonly _type: 'Formula';
}

export type LayoutSpacerConfig = FlexProps;

export interface LayoutSpacerNode extends LayoutSpacerConfig, LayoutSourceMetadata {
  readonly _type: 'Spacer';
}

export type LayoutLeafNode =
  | LayoutTextNode
  | LayoutShapeNode
  | LayoutChartNode
  | LayoutTableNode
  | LayoutImageNode
  | LayoutSvgGraphicNode
  | LayoutFormulaNode
  | LayoutSpacerNode;

export type LayoutNode = LayoutContainerNode | LayoutLeafNode;

export interface FlexComposeInput {
  title: string;
  layout?: SlideLayout;
  theme?: LayoutThemeInput;
  slides: LayoutSlideNode[];
}

export function isContainerNode(node: LayoutNode): node is LayoutContainerNode {
  return node._type === 'Slide' || node._type === 'View';
}

export function isLeafNode(node: LayoutNode): node is LayoutLeafNode {
  return !isContainerNode(node);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 判断原始 compose 输入是否为布局树格式。
 * 只做形状判定，不加载 Yoga 或编译器，方便 sandbox profile 与工具管线共同复用。
 */
export function isFlexComposeInput(raw: unknown): raw is FlexComposeInput {
  if (!isRecord(raw)) return false;
  const slides = raw.slides;
  if (!Array.isArray(slides) || slides.length === 0) return false;
  return slides.every(
    (slide) => isRecord(slide) && slide._type === 'Slide' && Array.isArray(slide.children),
  );
}
