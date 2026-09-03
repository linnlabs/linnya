import { renderMathMlToSvg } from '@linnya/slides-mathjax-runtime';
import type { MathFormulaMetrics, MathFormulaSource } from '@plugin/slides/shared';
import type { CanonicalFormulaIr } from '../definitions/canonicalFormula';
import { MathFormulaCompileError } from '../definitions/MathFormulaCompileError';
import { emitFormulaMathMl } from './emitFormulaMathMl';

const MATHJAX_UNITS_PER_EM = 1_000;
const INK_SAFETY_PADDING_EM = 0.08;
export interface FormulaSvgProjection {
  readonly canonicalSvg: string;
  readonly viewBox: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly contentViewBox: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly metrics: MathFormulaMetrics;
}

export function projectFormulaSvg(ir: CanonicalFormulaIr, source: MathFormulaSource): FormulaSvgProjection {
  try {
    const mathMl = emitFormulaMathMl(ir, source);
    const projection = renderMathMlToSvg({
      mathMl,
      display: source.display === 'block',
      color: source.color,
      altText: source.altText,
      paddingUnits: MATHJAX_UNITS_PER_EM * INK_SAFETY_PADDING_EM,
    });
    if (/<text\b/iu.test(projection.canonicalSvg)) {
      throw new MathFormulaCompileError(
        'slides.formula.unsupported_syntax',
        '公式包含当前数学字形集无法转换为路径的字符；请把说明文字放在公式外的普通文本中。',
      );
    }

    return {
      ...projection,
      metrics: buildMetrics(projection.contentViewBox, source.fontSize),
    };
  } catch (error) {
    if (error instanceof MathFormulaCompileError) throw error;
    throw new MathFormulaCompileError(
      'slides.formula.projection_failed',
      `公式 SVG 排版失败：${errorMessage(error)}`,
    );
  }
}

function buildMetrics(
  contentViewBox: FormulaSvgProjection['contentViewBox'],
  fontSizePt: number,
): MathFormulaMetrics {
  const emInches = fontSizePt / 72;
  const scale = emInches / MATHJAX_UNITS_PER_EM;
  const ascentUnits = Math.max(0, -contentViewBox.y);
  const descentUnits = Math.max(0, contentViewBox.y + contentViewBox.height);
  return {
    advanceWidth: round(contentViewBox.width * scale),
    ascent: round(ascentUnits * scale),
    descent: round(descentUnits * scale),
    inkBounds: {
      x: round(contentViewBox.x * scale),
      y: round(contentViewBox.y * scale),
      width: round(contentViewBox.width * scale),
      height: round(contentViewBox.height * scale),
    },
    nativeEnvelope: {
      ascentEm: round(ascentUnits / MATHJAX_UNITS_PER_EM),
      descentEm: round(descentUnits / MATHJAX_UNITS_PER_EM),
    },
  };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
