import type { DeckSpec } from '@plugin/slides/shared';
import { FreeformPptxCompiler } from './FreeformPptxCompiler';
import { PptxPackageSanitizer } from './pptx/PptxPackageSanitizer';
import { initializePptxDocument } from './pptx/initializePptxDocument';
import {
  createPptxPaintCompileContext,
  createPptxPaintPatchPlan,
} from './visual/pptxPaintPatchPlan';
import {
  createFormulaPptxCompileContext,
  createFormulaPptxPatchPlan,
} from './mathFormula/pptx/formulaPptxPlan';
import { createShapeTextAutofitPlan } from './text/shapeTextAutofitPptx';
import { prepareShapeTextAutofit } from './text/prepareShapeTextAutofit';

/** Host / 显式 in-process 编译入口；纯 Worker 使用 FreeformPptxCompiler。 */
export class FreeformCompiler extends FreeformPptxCompiler {
  private readonly sanitizer = new PptxPackageSanitizer();
  /** 编译完整 freeform deck */
  async compileDeck(deckSpec: DeckSpec): Promise<Buffer> {
    const shapeTextLayouts = await prepareShapeTextAutofit(deckSpec);
    const pptx = this.createPptx();
    initializePptxDocument(pptx, deckSpec);

    const paintPlan = createPptxPaintPatchPlan();
    const formulaPlan = createFormulaPptxPatchPlan();
    const shapeTextPlan = createShapeTextAutofitPlan();
    for (let slideIndex = 0; slideIndex < deckSpec.slides.length; slideIndex++) {
      const entry = deckSpec.slides[slideIndex];
      if (entry.spec.type !== 'freeform') {
        throw new Error(
          'Structured slides are not supported by FreeformCompiler. Use DeckAssembler for mixed decks.'
        );
      }
      this.compileSlide(
        pptx,
        entry.spec,
        deckSpec.theme,
        createPptxPaintCompileContext(paintPlan, slideIndex),
        undefined,
        createFormulaPptxCompileContext(formulaPlan, slideIndex),
        { plan: shapeTextPlan, slideIndex, layouts: shapeTextLayouts[slideIndex] }
      );
    }

    const result = await pptx.write({ outputType: 'nodebuffer' });
    return this.sanitizer.sanitize(Buffer.from(result as ArrayBuffer), {
      paintPlan,
      formulaPlan,
      shapeTextPlan,
      declaredThemeFonts: deckSpec.theme?.fonts,
    });
  }
}
