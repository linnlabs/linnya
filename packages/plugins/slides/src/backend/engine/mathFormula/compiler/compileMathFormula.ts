import { createHash } from 'node:crypto';
import type { MathFormulaRenderProjection, MathFormulaSource } from '@plugin/slides/shared';
import type { CanonicalFormulaIr } from '../definitions/canonicalFormula';
import { emitBlockFormulaOmml, emitInlineFormulaOmml } from './emitFormulaOmml';
import { parseLatexFormula } from './parseLatexFormula';
import { projectFormulaSvg } from './projectFormulaSvg';

export interface CompiledMathFormula {
  readonly ir: CanonicalFormulaIr;
  readonly renderProjection: MathFormulaRenderProjection;
  readonly blockOmml: string;
  readonly inlineOmml: string;
}

export function compileMathFormula(source: MathFormulaSource): CompiledMathFormula {
  const ir = parseLatexFormula(source.latex);
  const svg = projectFormulaSvg(ir, source);
  return {
    ir,
    renderProjection: {
      ...svg,
      contentHash: createHash('sha256').update(svg.canonicalSvg).digest('hex'),
      altText: source.altText,
      align: source.align,
    },
    blockOmml: emitBlockFormulaOmml(ir, source),
    inlineOmml: emitInlineFormulaOmml(ir, source),
  };
}
