import { beforeAll, describe, expect, it } from 'vitest';
import { isSlideRenderModel } from '@plugin/slides/shared/renderModel';
import { LayoutLint } from '../../../quality/LayoutLint';
import { renderModelToLintInfo } from '../../../quality/renderModelToLintInfo';
import { compilePresentationComposePayload } from '../../../../features/presentationBuildExecution/functions/compilePresentationComposePayload';
import { buildDeckSpecFromDirectInput, readCompiledDirectComposeInput } from '../../../../codegen/compose/presentationComposeInput.js';
import { compileFlexInput } from '../../../../codegen/compose/flex-layout/FlexLayoutCompiler.js';
import { initYoga } from '../../../../codegen/compose/flex-layout/YogaAdapter.js';
import { mapGeneratedSlide } from '../GeneratedRenderModelMapper.js';
import { resolveRenderDefaults } from '../RenderModelShared.js';

describe('generated layout constraint evidence pipeline', () => {
  beforeAll(async () => {
    await initYoga();
  });

  it('装饰意图与出血授权经过 Worker DTO、DeckSpec、RenderModel 到达诊断', async () => {
    const compiled = await compilePresentationComposePayload({
      title: 'Bleed intent',
      slides: [{ _type: 'Slide', children: [
        { _type: 'Shape', role: 'decoration', bleed: 0.2, x: -0.1, y: 1, width: 2, height: 1, fill: '#123456' },
        { _type: 'Shape', role: 'background', x: -0.3, y: 3, width: 2, height: 1, fill: '#654321' },
      ] }],
    });
    if (!compiled.ok) throw new Error(compiled.message);
    const parsed = readCompiledDirectComposeInput(compiled.input);
    if (!parsed.input) throw new Error(parsed.error);
    const deck = buildDeckSpecFromDirectInput(parsed.input);
    const slide = mapGeneratedSlide(deck.slides[0], 0, resolveRenderDefaults(deck.theme), new Map());
    expect(isSlideRenderModel(slide)).toBe(true);
    expect(slide.elements[0].editableTarget?.semanticRole).toBe('decoration');
    const info = renderModelToLintInfo({
      presentationId: 'test', version: 1, title: 'Bleed intent', sourceKind: 'generated',
      slideSize: { width: 10, height: 5.625, unit: 'in' }, slides: [slide],
    });
    const bounds = new LayoutLint().lint(info).issues.filter(issue => issue.code === 'out_of_bounds');
    expect(bounds).toHaveLength(1);
    expect(bounds[0].severity).toBe('info');
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
            { _type: 'Shape', flex: 1, width: 8, height: 1, fill: '#111111' },
            { _type: 'Shape', flex: 1, width: 8, height: 1, fill: '#222222' },
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
