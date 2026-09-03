import type { Box, MathFormulaSource } from '@plugin/slides/shared';
import { compileMathFormula } from '../compiler/compileMathFormula';

export interface FormulaPptxPatchPlanEntry {
  readonly slideIndex: number;
  readonly formulaId: string;
  readonly objectName: string;
  readonly placeholderToken: string;
  readonly position: Box;
  readonly source: MathFormulaSource;
  readonly mode: 'block' | 'inline';
  readonly omml: string;
}

export interface FormulaPptxPatchPlan {
  readonly entries: FormulaPptxPatchPlanEntry[];
}

export interface FormulaPptxCompileContext {
  register(source: MathFormulaSource, position: Box): FormulaPptxPatchPlanEntry;
  createInlineTextBox(position: Box): FormulaPptxInlineTextBoxContext;
}

export interface FormulaPptxInlineTextBoxContext {
  readonly objectName: string;
  register(source: MathFormulaSource): FormulaPptxPatchPlanEntry;
}

export function createFormulaPptxPatchPlan(): FormulaPptxPatchPlan {
  return { entries: [] };
}

export function createFormulaPptxCompileContext(
  plan: FormulaPptxPatchPlan,
  slideIndex: number,
): FormulaPptxCompileContext {
  let sequence = 0;
  return {
    register(source, position) {
      sequence += 1;
      const suffix = `${slideIndex + 1}_${sequence}`;
      const entry: FormulaPptxPatchPlanEntry = {
        slideIndex,
        formulaId: `formula-${suffix}`,
        objectName: `Linnya Formula ${suffix}`,
        placeholderToken: `LINNYA_FORMULA_${suffix}`,
        position,
        source,
        mode: 'block',
        omml: compileMathFormula(source).blockOmml,
      };
      plan.entries.push(entry);
      return entry;
    },
    createInlineTextBox(position) {
      sequence += 1;
      const boxSequence = sequence;
      const objectName = `Linnya Formula Text ${slideIndex + 1}_${boxSequence}`;
      let formulaSequence = 0;
      return {
        objectName,
        register(source) {
          formulaSequence += 1;
          const suffix = `${slideIndex + 1}_${boxSequence}_${formulaSequence}`;
          const entry: FormulaPptxPatchPlanEntry = {
            slideIndex,
            formulaId: `inline-formula-${suffix}`,
            objectName,
            placeholderToken: `LINNYA_INLINE_FORMULA_${suffix}`,
            position,
            source,
            mode: 'inline',
            omml: compileMathFormula(source).inlineOmml,
          };
          plan.entries.push(entry);
          return entry;
        },
      };
    },
  };
}
