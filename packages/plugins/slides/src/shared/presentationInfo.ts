/**
 * PPTX 解析结果类型定义
 */

import type { EditableTarget, RenderChartType, RenderLineSpacing } from './renderModel';
import type { GeneratedLayoutConstraintEvidence } from './generatedLayoutConstraints';
import type { TextLayoutResult } from './textLayout';
import type { TextLineSpacingResolution } from './textLayout';
import type { SlideBox } from './deckSpec';
import type { ResolvedShapeGeometry } from './shapeGeometry';
import type { ThemeChartSpec } from './visual';
import type { Paint, ShapeStrokeStyle } from './visual/paint';
import type {
  TextFontFaceFingerprint,
  TextFontResolutionKind,
  TextFontScript,
} from './textFontIdentity';
import type { SvgGraphicFit, SvgGraphicViewBox } from './svgGraphic';

export interface SlideElementSvgGraphicInfo {
  /** 包内 SVG part，仅用于审计和关系定位。 */
  sourcePartPath: string;
  /** admission 后的唯一 canonical 内容，供 imported render/roundtrip 使用。 */
  canonicalSvg: string;
  contentHash: string;
  viewBox: SvgGraphicViewBox;
  fit: SvgGraphicFit;
  altText?: string;
  decorative: boolean;
}

export interface SlideElementImportFidelity {
  readonly status: 'raster-fallback';
  readonly reason: 'unsupported_svg' | 'unavailable_svg';
}

export interface SlideElementTextStyleInfo {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
}

export interface SlideElementTextBodyInfo {
  autoFit?: 'none' | 'shrink-text' | 'resize-shape';
  wrap?: 'word' | 'char' | 'none';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  padding?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export interface SlideElementTextRunInfo {
  text: string;
  /** 原始字体声明，PPTX 导出语义。 */
  fontFamily?: string;
  /** 平台字体服务解析后的渲染/测量字体。 */
  resolvedFontFamily?: string;
  fontScript?: TextFontScript;
  fontResolution?: TextFontResolutionKind;
  fontFaceFingerprint?: TextFontFaceFingerprint;
  /** 平台最终选择的 face 样式，用于识别请求 regular 却命中 bold 等事实。 */
  resolvedBold?: boolean;
  resolvedItalic?: boolean;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
}

export interface SlideElementParagraphInfo {
  /** 与 OOXML a:p 一一对应，软换行保留为 run 文本中的 `\n`。 */
  runs: SlideElementTextRunInfo[];
  align?: 'left' | 'center' | 'right' | 'justify';
  spacingBeforePt?: number;
  spacingAfterPt?: number;
  lineSpacing?: RenderLineSpacing;
  lineSpacingResolution?: TextLineSpacingResolution;
  indentInches?: number;
}

/**
 * 形状视觉属性（与 ShapeStyle 字段保持一致的子集，单位严格按 ai-ppt §4.4 单位契约）。
 *
 * 主要由 PptxReader 在解析 imported / patched PPT 中带 prstGeom 的 `p:sp` 时填充，
 * 让 canonical / render-model 链路能拿到 fill / border / cornerRadius / shadow / shapeKind，
 * 避免「带文字的 shape」在 imported 路径下退化为纯 textbox 而丢失视觉语义。
 */
export interface SlideElementShapeVisual {
  /** OOXML `a:prstGeom@prst`，例如 'rect' | 'roundRect' | 'ellipse' | 'triangle'。 */
  shapeKind?: string;
  /** imported OOXML `a:custGeom` 回读后的规范化几何。 */
  geometry?: ResolvedShapeGeometry;
  /** shape 原生填充；导入的 solid / linear / radial / noFill 都保留语义。 */
  paint?: Paint;
  border?: ShapeStrokeStyle;
  /** 单位 = inches，与 ShapeStyle.borderRadius 一致。 */
  cornerRadius?: number;
  shadow?: {
    color: string;
    /** 单位 = pt。 */
    blur: number;
    /** 单位 = pt。 */
    offsetX: number;
    /** 单位 = pt。 */
    offsetY: number;
    opacity?: number;
  };
}

/**
 * 图表质量检查需要的最终可见事实。
 *
 * 这里只保留标签身份与容量判定需要的窄字段；完整 series values、配色和
 * renderer 配置仍由 RenderModel 拥有，不能复制进 quality 输入。
 */
export interface SlideElementChartInfo {
  chartType: RenderChartType;
  categoryLabels: string[];
  seriesNames: string[];
  legend: {
    visible: boolean;
    position: 'top' | 'bottom' | 'left' | 'right';
    fontSizePt: number;
  };
  dataLabels: {
    visible: boolean;
    position: 'inside' | 'outside' | 'center';
    fontSizePt: number;
    /** 默认标签包含类别名；显式 format 时只保证数值可见。 */
    includesCategoryName: boolean;
  };
  categoryAxis: {
    visible: boolean;
    fontSizePt: number;
  };
}

/**
 * 表格单元格的最终文字布局事实。
 *
 * 单元格不是独立 RenderNode，quality 仍需要知道具体 row/col 与最终断行；
 * 因此把这组窄事实挂在表格节点上，而不是伪造会参与空间/审美统计的子节点。
 */
export interface SlideElementTableCellTextInfo {
  /** 与 RenderTableCell 一致，从 0 开始，可直接定位源码 rows[rowIndex][columnIndex]。 */
  rowIndex: number;
  columnIndex: number;
  position: SlideBox;
  text?: string;
  paragraphs: SlideElementParagraphInfo[];
  padding: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  textLayout?: TextLayoutResult;
}

export interface SlideElementTableInfo {
  cells: SlideElementTableCellTextInfo[];
}

export interface SlideElementInfo {
  name: string;
  /** RenderModel 节点身份；imported 路径可以不提供。 */
  nodeId?: string;
  /** RenderModel 中的直接父节点身份，用于保留显式组件关系。 */
  parentNodeId?: string;
  creationId?: string;
  /** 稳定元素 ID，由 CanonicalBuilder 生成。优先 creationId，fallback position hash。 */
  elementId?: string;
  type: 'text' | 'image' | 'svgGraphic' | 'formula' | 'chart' | 'table' | 'shape' | 'group' | 'other';
  /** RenderModel 中的绘制顺序；imported 路径暂不保证提供。 */
  zIndex?: number;
  /** 节点整体透明度，范围 0..1；用于识别遮罩等有意叠放。 */
  opacity?: number;
  /** generated 节点的窄语义角色，例如 primary-visual / annotation。 */
  semanticRole?: string;
  text?: string; // 文本内容（仅 text 类型）
  position?: SlideBox;
  /**
   * 元素旋转角度（度，0–360）。
   * - PptxReader：从 OOXML `a:xfrm@rot`（60000 = 1 度）转换
   * - RenderModel：从 RenderNode.rotation 透传
   */
  rotation?: number;
  /** 形状视觉属性（仅 shape 类型，由 PptxReader 提取）。 */
  shapeVisual?: SlideElementShapeVisual;
  /**
   * 文本元素的最大字号（pt）。
   * 用于 LayoutLint 判断文字是否溢出 bounding box。
   * - PptxReader：从 OOXML `a:rPr/@sz`（百分之一磅）提取并转换
   * - Flex 编译：从 DirectElementInput.fontSize 透传
   */
  fontSize?: number;
  textStyle?: SlideElementTextStyleInfo;
  textBody?: SlideElementTextBodyInfo;
  paragraphs?: SlideElementParagraphInfo[];
  /** RenderModel 转 lint 时携带的最终布局事实；imported parser 可不提供。 */
  textLayout?: TextLayoutResult;
  /** generated Flex/Yoga 的约束事实；imported parser 不提供。 */
  layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
  chartType?: string; // 仅 chart 类型
  /** RenderModel 路径提供的图表标签最终事实；imported parser 暂不提供。 */
  chartInfo?: SlideElementChartInfo;
  /** RenderModel 路径提供的表格单元格最终文字布局事实。 */
  tableInfo?: SlideElementTableInfo;
  imageRef?: string; // 仅 image 类型
  /** admitted SVG picture 的回读事实；只在 type=svgGraphic 时存在。 */
  svgGraphic?: SlideElementSvgGraphicInfo;
  /** 外部 SVG 无法进入 canonical 子集时保留 raster fallback 的显式降级事实。 */
  importFidelity?: SlideElementImportFidelity;
  /**
   * 形状/表格 cell 等纯色填充的 hex 字符串（如 "#FFFFFF"）。
   * 渐变 / 无填充 时为 undefined。供 AestheticLint 颜色规则消费。
   * - RenderModel 路径：从 ShapeRenderNode.fill (type=solid) 提取
   * - PptxReader 路径：暂不填充（lint 默认跳过）
   */
  fill?: string;
  /**
   * 文本元素首个 run 的颜色（hex）。供 AestheticLint 颜色规则 / 对比度规则消费。
   * - RenderModel 路径：取 paragraphs[0].runs[0].color
   * - 缺省时 lint 视该元素为"主题色"，不参与规则
   */
  textColor?: string;
  /**
   * 图片适应模式（仅 image 类型）。
   * - RenderModel 路径：从 ImageRenderNode.fitMode 透传
   * - 用于 AestheticLint 的"stretch + 宽高比偏差过大"规则
   */
  imageFit?: 'fill' | 'contain' | 'cover' | 'stretch';
  /**
   * 图片原始宽高比 = naturalWidth / naturalHeight（仅 image 类型）。
   * 当 naturalSize 任一边 ≤ 0 时为 undefined。
   */
  imageNaturalAspect?: number;
  children?: SlideElementInfo[];
  editableTarget?: EditableTarget;
}

export interface SlideInfo {
  number: number;
  layoutName?: string;
  /** slide OOXML 背景；未显式设置时为空，由主题/默认白色补齐。 */
  backgroundPaint?: Paint;
  elements: SlideElementInfo[];
}

export interface ThemeInfo {
  colors: Record<string, string>; // dk1, dk2, lt1, lt2, accent1-6, hlink, folHlink
  fonts: {
    major: string;
    minor: string;
  };
  chart?: ThemeChartSpec;
  name?: string;
}

export interface MasterInfo {
  name: string;
  layouts: string[];
}

export interface PresentationInfo {
  slideCount: number;
  slideSize: {
    width: number;
    height: number;
  }; // inches
  slides: SlideInfo[];
  theme: ThemeInfo;
  masters: MasterInfo[];
}

export function visitSlideElements(
  elements: SlideElementInfo[],
  visitor: (entry: { element: SlideElementInfo; parent?: SlideElementInfo }) => void,
  parent?: SlideElementInfo,
): void {
  for (const element of elements) {
    visitor({ element, parent });
    if (element.children && element.children.length > 0) {
      visitSlideElements(element.children, visitor, element);
    }
  }
}

export function flattenSlideElements(
  elements: SlideElementInfo[],
): SlideElementInfo[] {
  const flattened: SlideElementInfo[] = [];
  visitSlideElements(elements, ({ element }) => {
    flattened.push(element);
  });
  return flattened;
}

export function findSlideElement(
  elements: SlideElementInfo[],
  predicate: (entry: { element: SlideElementInfo; parent?: SlideElementInfo }) => boolean,
): SlideElementInfo | undefined {
  let found: SlideElementInfo | undefined;
  visitSlideElements(elements, (entry) => {
    if (!found && predicate(entry)) {
      found = entry.element;
    }
  });
  return found;
}
