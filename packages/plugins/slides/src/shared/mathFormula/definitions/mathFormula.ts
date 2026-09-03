import type { SlideSourceSpan } from '../../documentSource';

export const MATH_FORMULA_PROFILE_VERSION = 1 as const;

export type MathFormulaAlign = 'left' | 'center' | 'right';

/** DeckSpec 长期保存的公式事实；内部 parser IR 不进入持久化合同。 */
export interface MathFormulaSource {
  readonly latex: string;
  readonly display: 'block' | 'inline';
  readonly profileVersion: typeof MATH_FORMULA_PROFILE_VERSION;
  readonly fontSize: number;
  readonly color: string;
  readonly align: MathFormulaAlign;
  readonly altText: string;
  readonly sourceSpan?: SlideSourceSpan;
}

export interface MathFormulaMetrics {
  readonly advanceWidth: number;
  readonly ascent: number;
  readonly descent: number;
  readonly inkBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly nativeEnvelope: {
    readonly ascentEm: number;
    readonly descentEm: number;
  };
}

/** RenderModel 只接收投影与度量，不接收 compiler AST。 */
export interface MathFormulaRenderProjection {
  readonly canonicalSvg: string;
  readonly contentHash: string;
  readonly viewBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** SVG 中真正承载公式墨迹的区域；renderer 据此缩放，禁止反推 compiler padding。 */
  readonly contentViewBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly metrics: MathFormulaMetrics;
  readonly altText: string;
  readonly align: MathFormulaAlign;
}

export const MATH_FORMULA_ERROR_CODES = [
  'slides.formula.invalid_source',
  'slides.formula.unsupported_syntax',
  'slides.formula.resource_limit_exceeded',
  'slides.formula.inline_formula_too_wide',
  'slides.formula.inline_formula_line_height_insufficient',
  'slides.formula.projection_failed',
  'slides.formula.pptx_patch_failed',
] as const;

export type MathFormulaErrorCode = (typeof MATH_FORMULA_ERROR_CODES)[number];

/** 跨 text finalizer、公式编译器与 Worker 边界保留的公式领域错误。 */
export class MathFormulaError extends Error {
  constructor(
    readonly code: MathFormulaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MathFormulaError';
  }
}

export function isMathFormulaErrorCode(value: unknown): value is MathFormulaErrorCode {
  return typeof value === 'string'
    && MATH_FORMULA_ERROR_CODES.some(code => code === value);
}
