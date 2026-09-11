/**
 * Slides 页面视觉元素合同。
 *
 * 这里放页面结构、元素、布局约束这类“可被生成/渲染/编辑共同理解”的稳定合同。
 * patch、工具编辑、relayout、deck 持久化合同仍留在 slideSpec.ts，避免单个 shared 文件继续膨胀。
 */

import type { SlideBox } from './boxes';
import type { SlideSourceSpan } from '../documentSource';
import type { GeneratedLayoutConstraintEvidence } from '../generatedLayoutConstraints';
import type { MathFormulaSource } from '../mathFormula';
import type { ShapeGeometrySpec } from '../shapeGeometry';
import type { SvgGraphicElementSpec } from '../svgGraphic';
import type { BrushArtworkSourceRef } from '../brushArtwork';
import type { TextLineSpacing } from '../textLayout/definitions/lineSpacing';
import type { TextWrapPolicy } from '../textLayout/definitions/contract';
import type { LayoutChartStyle } from '../flexComposeContract';
import type {
  GradientPaint,
  GradientStop,
  Paint,
  ShapeStrokeStyle,
} from '../visual/paint/definitions/paint';

/** 位置和尺寸（单位：inches） */
export type Box = SlideBox;

/** deck.js 源码行号定位，1-based，闭区间。 */
export type SourceSpan = SlideSourceSpan;

/** 文本样式 */
export interface TextStyle {
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string; // hex, e.g. '#333333'
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  /** 字间距，单位 = pt */
  letterSpacing?: number;
  /** 段落行距；内部只接受明确的 multiple / exactPt 语义。 */
  lineSpacing?: TextLineSpacing;
}

/** 形状样式 */
export interface ShapeStyle {
  /** 当前统一填充合同。 */
  paint?: Paint;
  /** @deprecated 仅供旧 DeckSpec admission；新 deck.js 使用 shape.fill 输入后会归一化为 paint。 */
  fill?: string;
  /** @deprecated 仅供旧 DeckSpec admission；新 deck.js 不暴露 style.gradient。 */
  gradient?: GradientPaint;
  border?: ShapeStrokeStyle;
  borderRadius?: number;
  shadow?: {
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
    opacity?: number;
  };
  opacity?: number;
  rotate?: number;
}

export type ImageSourceRef =
  | { kind: 'external_url'; url: string }
  | { kind: 'data_uri'; dataUri: string }
  | { kind: 'local_path'; path: string }
  | { kind: 'generated_asset'; assetId: string }
  | BrushArtworkSourceRef;

export type ResolvedImageAsset =
  | { kind: 'data_uri'; dataUri: string }
  | { kind: 'local_file'; path: string };

export interface ImageVisualShadow {
  color?: string;
  blur?: number;
  angle?: number;
  distance?: number;
  opacity?: number;
}

export interface ImageVisualOptions {
  fitMode?: 'cover' | 'contain' | 'crop';
  maskShape?: 'rect' | 'circle';
  rounding?: boolean;
  transparency?: number;
  shadow?: ImageVisualShadow;
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
}

export type ImageSourceInput = ImageSourceRef | string;

/** @deprecated 使用 GradientStop；保留名称用于旧调用方平滑迁移。 */
export type SlideBackgroundGradientStop = GradientStop;
/** @deprecated 使用 GradientPaint；保留名称用于旧调用方平滑迁移。 */
export type SlideBackgroundGradient = GradientPaint;

export type ChartType = 'bar' | 'line' | 'pie' | 'doughnut' | 'scatter' | 'area' | 'radar';

export interface ChartSeries {
  name: string;
  labels: string[];
  values: number[];
}

export interface TableCell {
  text: string;
  style?: TextStyle;
  fill?: string;
  colspan?: number;
  rowspan?: number;
}

export type StructuredElement =
  | {
      type: 'title';
      content: string;
      textWrap?: TextWrapPolicy;
      style?: TextStyle;
      position: Box;
      _semanticNodeId?: string;
      _semanticRole?: string;
      _overlayId?: string;
      _sourceSpan?: SourceSpan;
      _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
    }
  | {
      type: 'text';
      content: string | FreeformInlineRun[];
      textWrap?: TextWrapPolicy;
      style?: TextStyle;
      position: Box;
      _semanticNodeId?: string;
      _semanticRole?: string;
      _overlayId?: string;
      _sourceSpan?: SourceSpan;
      _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
    }
  | {
      type: 'bulletList';
      items: Array<{ text: string; level?: number }>;
      style?: TextStyle;
      position: Box;
      _semanticNodeId?: string;
      _semanticRole?: string;
      _overlayId?: string;
      _sourceSpan?: SourceSpan;
      _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
    }
  | {
      type: 'numberedList';
      items: Array<{ text: string; level?: number }>;
      style?: TextStyle;
      position: Box;
      _semanticNodeId?: string;
      _semanticRole?: string;
      _overlayId?: string;
      _sourceSpan?: SourceSpan;
      _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
    }
  | {
      type: 'chart';
      chartType: ChartType;
      data: {
        categories: string[];
        series: ChartSeries[];
      };
      position: Box;
      /** deck.js 的稳定颜色语义；进入 RenderModel 前仍保留原始意图。 */
      chartStyle?: LayoutChartStyle;
      options?: Record<string, unknown>;
      _semanticNodeId?: string;
      _semanticRole?: string;
      _overlayId?: string;
      _sourceSpan?: SourceSpan;
      _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
    }
  | {
      type: 'table';
      headers?: string[];
      rows: TableCell[][];
      position: Box;
      /** 已归一化的统一表格描边。 */
      border?: ShapeStrokeStyle;
      options?: Record<string, unknown>;
      _semanticNodeId?: string;
      _semanticRole?: string;
      _overlayId?: string;
      _sourceSpan?: SourceSpan;
      _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
    }
  | {
      type: 'image';
      src: ImageSourceInput;
      position: Box;
      alt?: string;
      fitMode?: ImageVisualOptions['fitMode'];
      maskShape?: ImageVisualOptions['maskShape'];
      rounding?: boolean;
      transparency?: number;
      shadow?: ImageVisualShadow;
      rotate?: number;
      flipH?: boolean;
      flipV?: boolean;
      _semanticNodeId?: string;
      _semanticRole?: string;
      _overlayId?: string;
      _sourceSpan?: SourceSpan;
      _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
    }
  | {
      type: 'shape';
      geometry: ShapeGeometrySpec;
      position: Box;
      style?: ShapeStyle;
      text?: string;
      _semanticNodeId?: string;
      _semanticRole?: string;
      _overlayId?: string;
      _sourceSpan?: SourceSpan;
      _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
    }
  | StructuredSvgGraphicElement
  | StructuredFormulaElement;

export interface StructuredFormulaElement {
  type: 'formula';
  source: MathFormulaSource;
  position: Box;
  _semanticNodeId?: string;
  _semanticRole?: string;
  _overlayId?: string;
  _sourceSpan?: SourceSpan;
  _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
}

export type StructuredSvgGraphicElement = SvgGraphicElementSpec & {
  type: 'svgGraphic';
  position: Box;
  _semanticNodeId?: string;
  _semanticRole?: string;
  _overlayId?: string;
  _sourceSpan?: SourceSpan;
  _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
};

export interface StructuredSlideSpec {
  type: 'structured';
  background?: {
    /** 当前统一背景填充合同。 */
    paint?: Paint;
    /** @deprecated 仅供旧 DeckSpec admission。 */
    color?: string;
    image?: ImageSourceInput;
    /** @deprecated deck.js 仍以 background.gradient 为公开输入，进入 DeckSpec 后归一化为 paint。 */
    gradient?: GradientPaint;
  };
  elements: StructuredElement[];
  notes?: string;
}

export interface FreeformTextRun {
  text: string;
  style?: TextStyle;
}

export interface FreeformFormulaTextRun {
  formula: MathFormulaSource;
}

export type FreeformInlineRun = FreeformTextRun | FreeformFormulaTextRun;

export interface FreeformElementBase {
  position: Box;
  style?: ShapeStyle & TextStyle;
  /** 内部标记：canonical node ID，不进 PPTX，仅供 render model 映射 */
  _semanticNodeId?: string;
  /** 内部标记：语义角色 */
  _semanticRole?: string;
  /** 内部标记：持久化 overlay 元素 ID */
  _overlayId?: string;
  /** 内部标记：deck.js 源码定位，不进 PPTX，仅供选区 AI 编辑 */
  _sourceSpan?: SourceSpan;
  _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
}

export interface FreeformTextElement extends FreeformElementBase {
  type: 'text';
  content?: string | FreeformInlineRun[];
  textWrap?: TextWrapPolicy;
}

export interface FreeformShapeElement extends FreeformElementBase {
  type: 'shape';
  geometry?: ShapeGeometrySpec;
  content?: string | FreeformTextRun[];
}

export interface FreeformImageElement extends FreeformElementBase {
  type: 'image';
  src?: ImageSourceInput;
  alt?: string;
  fitMode?: ImageVisualOptions['fitMode'];
  maskShape?: ImageVisualOptions['maskShape'];
  rounding?: boolean;
  transparency?: number;
  shadow?: ImageVisualShadow;
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
}

export type FreeformSvgGraphicElement = Omit<FreeformElementBase, 'style'>
  & SvgGraphicElementSpec
  & {
    type: 'svgGraphic';
    /** SVG 图形不接受通用 shape/text style；该字段仅让联合类型保持可判别。 */
    style?: never;
  };

export type FreeformFormulaElement = Omit<FreeformElementBase, 'style'> & {
  type: 'formula';
  source: MathFormulaSource;
  /** 公式样式属于 FormulaSource，不接受通用 shape/text style。 */
  style?: never;
};

export interface FreeformGroupElement extends FreeformElementBase {
  type: 'group';
  children?: FreeformElement[];
}

export type FreeformElement =
  | FreeformTextElement
  | FreeformShapeElement
  | FreeformImageElement
  | FreeformSvgGraphicElement
  | FreeformFormulaElement
  | FreeformGroupElement;

export interface FreeformSlideSpec {
  type: 'freeform';
  background?: {
    /** 当前统一背景填充合同。 */
    paint?: Paint;
    /** @deprecated 仅供旧 DeckSpec admission。 */
    color?: string;
    image?: ImageSourceInput;
    /** @deprecated deck.js 仍以 background.gradient 为公开输入，进入 DeckSpec 后归一化为 paint。 */
    gradient?: GradientPaint;
  };
  elements: FreeformElement[];
  notes?: string;
}
