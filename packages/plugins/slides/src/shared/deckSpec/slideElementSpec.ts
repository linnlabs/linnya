import type { LayoutReplay } from '../generatedLayoutReplay';
/**
 * Slides 页面视觉元素合同。
 *
 * 这里放页面结构、元素、布局约束这类“可被生成/渲染/编辑共同理解”的稳定合同。
 * patch、工具编辑、relayout、deck 持久化合同仍留在 slideSpec.ts，避免单个 shared 文件继续膨胀。
 */

import type { SlideBox } from './boxes';
import type { ImageAdjust } from './imageAdjust';
import type { SlideSourceSpan } from '../documentSource';
import type { GeneratedLayoutConstraintEvidence } from '../generatedLayoutConstraints';
import type { MathFormulaSource } from '../mathFormula';
import type { ImageMaskShapeSpec, ShapeGeometrySpec } from '../shapeGeometry';
import type { SvgGraphicElementSpec } from '../svgGraphic';
import type { BrushArtworkSourceRef } from '../brushArtwork';
import type { SlidesAuthoringObjectRef } from '../authoringEditing';
import type { TextLineSpacing } from '../textLayout/definitions/lineSpacing';
import type { TextWrapPolicy } from '../textLayout/definitions/contract';
import type { LayoutChartControls, LayoutChartSeriesInput, LayoutChartStyle, LayoutChartType } from '../flexComposeContract';
import type {
  GradientPaint,
  GradientStop,
  LinearGradientPaint,
  NoPaint,
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
  /** 文字方向；缺省为横排。只在文本元素级生效。 */
  writingMode?: 'vertical-rl';
  /** 字间距，单位 = pt */
  letterSpacing?: number;
  /** 段落行距；内部只接受明确的 multiple / exactPt 语义。 */
  lineSpacing?: TextLineSpacing;
  /** 字形本身的效果（不是文本框的底色和边框）；只在文本元素级生效，整段文字共用。 */
  effects?: TextEffects;
}

/**
 * 文字效果，对应 PowerPoint 字符属性：渐变或不填充、描边、外阴影、透明度。
 * 渐变按每行文字的外框铺：同一行的多段 run 共用一条，换行后重新开始（PowerPoint 实测）。
 */
export interface TextEffects {
  /** 线性渐变，或不填充（只剩描边的空心字）；纯色仍用 TextStyle.color。 */
  fill?: LinearGradientPaint | NoPaint;
  /** 字形描边，width 单位 pt。 */
  stroke?: { color: string; width: number };
  shadow?: ShapeShadow;
  /** 字形填充与描边的不透明度 0–1，不影响阴影。 */
  opacity?: number;
}

/** 直角坐标的外阴影；偏移与模糊单位 pt。 */
export interface ShapeShadow {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
  opacity?: number;
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
  shadow?: ShapeShadow;
  opacity?: number;
  rotate?: number;
}

export type ImageSourceRef =
  | { kind: 'external_url'; url: string }
  | { kind: 'data_uri'; dataUri: string }
  | { kind: 'local_path'; path: string }
  | { kind: 'generated_asset'; assetId: string }
  | { kind: 'document_asset'; assetId: string }
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

/** 从原图四边各裁掉的比例（0–1）；与 PowerPoint 裁剪、OOXML `a:srcRect` 同义，先于 fitMode 生效。 */
export interface ImageCropSpec {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 原图上的归一化点（0–1）；cover 时取景窗尽量以它为中心。 */
export interface ImageFocusSpec {
  x: number;
  y: number;
}

export interface ImageVisualOptions {
  fitMode?: 'cover' | 'contain' | 'crop';
  crop?: ImageCropSpec;
  focus?: ImageFocusSpec;
  /** 图片遮罩：`circle`，或与 Shape `geometry` 相同的写法；套在实际画面框上。 */
  maskShape?: ImageMaskShapeSpec;
  rounding?: boolean;
  transparency?: number;
  shadow?: ImageVisualShadow;
  /** 调色；公式与 PowerPoint 的 a:lum / a:grayscl / a:duotone 一致。 */
  adjust?: ImageAdjust;
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
}

export type ImageSourceInput = ImageSourceRef | string;

/** @deprecated 使用 GradientStop；保留名称用于旧调用方平滑迁移。 */
export type SlideBackgroundGradientStop = GradientStop;
/** @deprecated 使用 GradientPaint；保留名称用于旧调用方平滑迁移。 */
export type SlideBackgroundGradient = GradientPaint;

export type ChartType = LayoutChartType;

export interface ChartSeries extends Omit<LayoutChartSeriesInput, 'labels'> {
  labels: string[];
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
      _authoringRef?: SlidesAuthoringObjectRef;
      _authoringAncestorRefs?: readonly SlidesAuthoringObjectRef[];
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
      _authoringRef?: SlidesAuthoringObjectRef;
      _authoringAncestorRefs?: readonly SlidesAuthoringObjectRef[];
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
      _authoringRef?: SlidesAuthoringObjectRef;
      _authoringAncestorRefs?: readonly SlidesAuthoringObjectRef[];
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
      _authoringRef?: SlidesAuthoringObjectRef;
      _authoringAncestorRefs?: readonly SlidesAuthoringObjectRef[];
      _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
    }
  | (LayoutChartControls & {
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
      _authoringRef?: SlidesAuthoringObjectRef;
      _authoringAncestorRefs?: readonly SlidesAuthoringObjectRef[];
      _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
    })
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
      _authoringRef?: SlidesAuthoringObjectRef;
      _authoringAncestorRefs?: readonly SlidesAuthoringObjectRef[];
      _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
    }
  | {
      type: 'image';
      src: ImageSourceInput;
      position: Box;
      alt?: string;
      fitMode?: ImageVisualOptions['fitMode'];
      crop?: ImageCropSpec;
      focus?: ImageFocusSpec;
      maskShape?: ImageVisualOptions['maskShape'];
      rounding?: boolean;
      transparency?: number;
      shadow?: ImageVisualShadow;
      adjust?: ImageAdjust;
      rotate?: number;
      flipH?: boolean;
      flipV?: boolean;
      _semanticNodeId?: string;
      _semanticRole?: string;
      _overlayId?: string;
      _sourceSpan?: SourceSpan;
      _authoringRef?: SlidesAuthoringObjectRef;
      _authoringAncestorRefs?: readonly SlidesAuthoringObjectRef[];
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
      _authoringRef?: SlidesAuthoringObjectRef;
      _authoringAncestorRefs?: readonly SlidesAuthoringObjectRef[];
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
  _authoringRef?: SlidesAuthoringObjectRef;
  _authoringAncestorRefs?: readonly SlidesAuthoringObjectRef[];
  _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
}

export type StructuredSvgGraphicElement = SvgGraphicElementSpec & {
  type: 'svgGraphic';
  position: Box;
  _semanticNodeId?: string;
  _semanticRole?: string;
  _overlayId?: string;
  _sourceSpan?: SourceSpan;
  _authoringRef?: SlidesAuthoringObjectRef;
  _authoringAncestorRefs?: readonly SlidesAuthoringObjectRef[];
  _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
};

export interface StructuredSlideSpec {
  layoutReplay?: LayoutReplay;
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
  _authoringRef?: SlidesAuthoringObjectRef;
  _authoringAncestorRefs?: readonly SlidesAuthoringObjectRef[];
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
  crop?: ImageCropSpec;
  focus?: ImageFocusSpec;
  maskShape?: ImageVisualOptions['maskShape'];
  rounding?: boolean;
  transparency?: number;
  shadow?: ImageVisualShadow;
  adjust?: ImageAdjust;
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
  layoutReplay?: LayoutReplay;
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
