import { beforeAll, describe, expect, it } from 'vitest';
import { isSlideRenderModel } from '@plugin/slides/shared/renderModel';
import { buildDeckSpecFromDirectInput } from '../../../../codegen/compose/presentationComposeInput.js';
import { compileFlexInput } from '../../../../codegen/compose/flex-layout/FlexLayoutCompiler.js';
import { initYoga } from '../../../../codegen/compose/flex-layout/YogaAdapter.js';
import { mapGeneratedSlide } from '../GeneratedRenderModelMapper.js';
import { resolveRenderDefaults } from '../RenderModelShared.js';

describe('generated layout constraint evidence pipeline', () => {
  beforeAll(async () => {
    await initYoga();
  });

  it('从 Flex 编译事实无损进入 DeckSpec、RenderModel 与 strict codec', () => {
    const compiled = compileFlexInput({
      title: 'Constraint evidence',
      slides: [{
        _type: 'Slide',
        children: [{
          _type: 'View',
          flexDirection: 'row',
          children: [
            { _type: 'Shape', width: 8, height: 1, fill: '#111111' },
            { _type: 'Shape', width: 8, height: 1, fill: '#222222' },
          ],
        }],
      }],
    });
    if (!compiled.input) throw new Error(compiled.error ?? 'Flex compile failed');

    const deck = buildDeckSpecFromDirectInput(compiled.input);
    const entry = deck.slides[0];
    if (!entry) throw new Error('Compiled deck has no slide');
    const slide = mapGeneratedSlide(
      entry,
      0,
      resolveRenderDefaults(deck.theme),
      new Map(),
    );

    expect(slide.elements[0]?.layoutConstraintEvidence).toMatchObject({
      layoutNodeId: 'layout:s1:root.0.0',
      positionMode: 'flow',
      declared: { widthInches: 8, heightInches: 1 },
      finalBox: { w: 5, h: 1, unit: 'in' },
      parent: { nodeId: 'layout:s1:root.0', kind: 'layout_container' },
    });
    expect(isSlideRenderModel(slide)).toBe(true);
  });
});
