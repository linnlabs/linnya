export type TextLayoutProfile =
  | 'plain-textbox'
  | 'title-textbox'
  | 'bullet-textbox'
  | 'shape-inner-text'
  | 'table-cell'
  | 'layout-planning';

export type TextWrapPolicy = 'word' | 'char' | 'none';

export type TextLineBreakPolicy =
  | 'office-compatible'
  | 'unicode-cjk-aware'
  | 'none';

export type TextAutoFitPolicy = 'none' | 'shrink-text' | 'resize-shape';

export interface TextBoxInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TextFontResolutionContract {
  /** 原始声明，PPTX 导出必须保留。 */
  declaredFontFamily?: string;
  /** 后端 FontResolutionService 解析后的事实字体，测量/预览优先消费。 */
  resolvedFontFamily?: string;
}

export interface TextLayoutContract {
  profile: TextLayoutProfile;
  sourceKind: 'generated' | 'imported' | 'ui-runtime';
  box: { x: number; y: number; w: number; h: number };
  padding: TextBoxInsets;
  wrap: TextWrapPolicy;
  lineBreak: TextLineBreakPolicy;
  autoFitPolicy: TextAutoFitPolicy;
  overflow: 'clip' | 'ellipsis' | 'visible';
  verticalAlign: 'top' | 'middle' | 'bottom';
  font: TextFontResolutionContract;
}

/**
 * PowerPoint 默认文本框内边距（OOXML bodyPr 未显式设置时的隐含默认值）。
 * 所有 generated/imported/bridge 文本策略都必须从这里读取，避免 cache key
 * 与渲染语义各自漂移。
 */
export const PPTX_DEFAULT_TEXT_INSET: TextBoxInsets = {
  top: 0.05,
  right: 0.1,
  bottom: 0.05,
  left: 0.1,
} as const;

/** PowerPoint 默认 bullet hanging indent：27pt。 */
export const BULLET_HANGING_INDENT_INCHES = 27 / 72;

export const DEFAULT_TEXT_WRAP_POLICY: TextWrapPolicy = 'word';
export const DEFAULT_TEXT_LINE_BREAK_POLICY: TextLineBreakPolicy = 'office-compatible';
export const DEFAULT_TEXT_OVERFLOW_POLICY: TextLayoutContract['overflow'] = 'clip';
export const DEFAULT_TEXT_VERTICAL_ALIGN: TextLayoutContract['verticalAlign'] = 'top';
export const DEFAULT_TEXT_AUTOFIT_POLICY: TextAutoFitPolicy = 'none';
/** normAutofit 使用离散字号档位；后续 M5 再用真实 PowerPoint 语料校准。 */
export const NORM_AUTOFIT_FONT_SCALE_CANDIDATES = [
  1,
  0.95,
  0.9,
  0.85,
  0.8,
  0.75,
  0.7,
  0.65,
  0.6,
  0.55,
  0.5,
  0.45,
  0.4,
  0.35,
  0.3,
  0.25,
] as const;
export const NORM_AUTOFIT_LINE_SPACING_REDUCTION_FACTOR = 0.2;
export const TITLE_TEXTBOX_MIN_AUTOFIT_SCALE = 0.9;
