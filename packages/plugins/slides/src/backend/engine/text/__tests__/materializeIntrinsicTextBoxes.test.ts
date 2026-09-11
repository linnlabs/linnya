import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defaultTextMeasureService } from '@linnya/text-measurement-core';
import { compileFlexInput } from '../../../codegen/compose/flex-layout/FlexLayoutCompiler';
import { initYoga } from '../../../codegen/compose/flex-layout/YogaAdapter';
import { buildDeckSpecFromDirectInput } from '../../../codegen/compose/presentationComposeInput';
import { RenderModelMapper } from '../../parser/RenderModelMapper';
import { materializeIntrinsicTextBoxes } from '../materializeIntrinsicTextBoxes';
import { applyTextLayoutToRenderModel } from '../renderModelTextLayout';

describe('intrinsic text materialization', () => {
  beforeAll(initYoga);
  afterEach(() => defaultTextMeasureService.resetAdapters());

  it('大字、字距和右锚点使用最终字形宽度落库，且不改固定宽度正文', async () => {
    defaultTextMeasureService.configureAdapters({ clusterAdvanceProvider: {
      kind: 'harfbuzz',
      measureClusterAdvancesWithSource(request) {
        return { source: 'harfbuzz', advances: request.clusters.map(() =>
          request.style.fontSizePt / 72 * (request.style.bold ? 0.9 : 0.7)
          + (request.style.letterSpacingPt ?? 0) / 72) };
      },
    } });
    const compiled = compileFlexInput({ title: 'Intrinsic', layout: { width: 10, height: 6, unit: 'in' }, slides: [{
      _type: 'Slide', children: [
        { _type: 'Text', content: '02', fontSize: 150, bold: true, x: 0, y: 0 },
        { _type: 'Text', content: 'DEEP CANOPY', fontSize: 8, letterSpacing: 3, right: 0.5, y: 4 },
        { _type: 'Text', content: 'fixed', fontSize: 10, width: 3, height: 1, x: 0, y: 5 },
        { _type: 'Text', content: 'A', fontSize: 10, minWidth: 4, x: 0, y: 5 },
      ],
    }] });
    if (!compiled.input) throw new Error(compiled.error);
    const deck = buildDeckSpecFromDirectInput(compiled.input);
    await materializeIntrinsicTextBoxes(deck);
    const elements = deck.slides[0].spec.elements;
    expect(elements[0].position.w).toBeCloseTo(3.95, 5);
    expect(elements[1].position.x + elements[1].position.w).toBeCloseTo(9.5, 3);
    expect(elements[2].position.w).toBe(3);
    expect(elements[3].position.w).toBe(4);
    expect(elements[0]._layoutConstraintEvidence?.intrinsicTextAdvanceSource).toBe('harfbuzz');
    const model = applyTextLayoutToRenderModel(new RenderModelMapper().fromGeneratedDeck(
      'test', 1, deck.title, deck, { width: 10, height: 6 },
    ));
    for (const node of model.slides[0].elements.slice(0, 2)) {
      if (node.kind !== 'text') throw new Error('expected text');
      expect(node.layout?.overflow.horizontal).toBe(false);
    }
  });
});
