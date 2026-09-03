/**
 * CanonicalDeck — 内部统一表示模型
 *
 * 不暴露给 Agent 或前端，仅在 coordinator/service 层使用。
 * 为 slide 和 element 提供稳定 ID，弱化对名称字符串的依赖。
 */

import type {
  SlideElementImportFidelity,
  SlideElementShapeVisual,
  SlideElementSvgGraphicInfo,
  ThemeInfo,
} from './presentationInfo';
import type { RenderLineSpacing, RenderPadding } from './renderModel';
import type { TextLineSpacingResolution } from './textLayout';
import type { Box, SlideSizeInches } from './deckSpec';
import type { Paint } from './visual/paint';
import type {
  TextFontFaceFingerprint,
  TextFontResolutionKind,
  TextFontScript,
} from './textFontIdentity';

export type CanonicalRole = 'title' | 'body' | 'chart' | 'table' | 'image' | 'svgGraphic' | 'shape' | 'group' | 'other';

export interface CanonicalPatchMeta {
  creationId?: string;
  elementName?: string;
}

/**
 * Canonical 视觉提示（imported / patched 链路专用）。
 * 由 PptxReader 提取的视觉语义透传到 canonical，再供 CanonicalRenderModelMapper 在缺失 specElement 时兜底。
 * 当走 generated 主链时，spec 里已有完整 ShapeStyle / fitMode，本字段保持 undefined 即可。
 */
export interface CanonicalVisualHints extends SlideElementShapeVisual {
  /** 形状纯色填充（hex）。 */
  fill?: string;
  /** 图片适应模式（仅 image 元素，由 PptxReader 推断）。 */
  fitMode?: 'fill' | 'contain' | 'cover' | 'stretch';
  /**
   * 文本框 / shape 内文本的垂直对齐（imported 路径由 PptxReader 从
   * `bodyPr@anchor` 提取）。generated 路径走 specElement.style.valign，本字段为空。
   */
  textVerticalAlign?: 'top' | 'middle' | 'bottom';
  /**
   * 文本框 / shape 内文本的 autofit 策略（imported 路径由 PptxReader 从
   * `bodyPr` 子节点 normAutofit / spAutoFit / noAutofit 提取）。
   */
  textAutoFit?: 'none' | 'shrink-text' | 'resize-shape';
  /** 文本框 / shape 内文本的 bodyPr padding（英寸）。 */
  textPadding?: RenderPadding;
  /** 文本框 / shape 内文本的 bodyPr wrap 策略。 */
  textWrap?: 'word' | 'char' | 'none';
}

export interface CanonicalTextRun {
  text: string;
  fontFamily?: string;
  resolvedFontFamily?: string;
  fontScript?: TextFontScript;
  fontResolution?: TextFontResolutionKind;
  fontFaceFingerprint?: TextFontFaceFingerprint;
  resolvedBold?: boolean;
  resolvedItalic?: boolean;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
}

export interface CanonicalTextParagraph {
  runs: CanonicalTextRun[];
  align?: 'left' | 'center' | 'right' | 'justify';
  lineSpacing?: RenderLineSpacing;
  lineSpacingResolution?: TextLineSpacingResolution;
  spacingBeforePt?: number;
  spacingAfterPt?: number;
  indentInches?: number;
}

export interface CanonicalElement {
  elementId: string;
  role: CanonicalRole;
  text?: string;
  /** imported 路径按 a:p 顺序保留的段落内容语义。 */
  paragraphs?: CanonicalTextParagraph[];
  position?: Box;
  zOrder: number;
  rotation?: number;
  children?: CanonicalElement[];
  chartType?: string;
  imageRef?: string;
  svgGraphic?: SlideElementSvgGraphicInfo;
  importFidelity?: SlideElementImportFidelity;
  /** 视觉提示，仅 imported / patched 路径填充；generated 路径走 specElement，本字段为空。 */
  visual?: CanonicalVisualHints;
  patchMeta: CanonicalPatchMeta;
}

export interface CanonicalSlide {
  slideId: string;
  number: number;
  layoutName?: string;
  backgroundPaint?: Paint;
  elements: CanonicalElement[];
}

export interface CanonicalDeck {
  nodeId: string;
  versionNumber: number;
  title: string;
  slideSize: SlideSizeInches;
  slides: CanonicalSlide[];
  theme: ThemeInfo;
  masterCount: number;
}
