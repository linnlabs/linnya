import { beforeAll, describe, expect, it } from 'vitest';
import { isSlideRenderModel } from '@plugin/slides/shared/renderModel';
import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';
import { LayoutLint } from '../../../quality/LayoutLint';
import { renderModelToLintInfo } from '../../../quality/renderModelToLintInfo';
import { SpatialAnalyzer } from '../../../quality/SpatialAnalyzer';
import { classifyDiagnosticPriority } from '../../../quality/definitions';
import { buildToolFeedbackPayload } from '../../../../tools/inspectFeedback/feedbackPayload';
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

  it('装饰意图与出血授权经过 Worker DTO、DeckSpec、RenderModel 和正式 finding 准入', async () => {
    const compiled = await compilePresentationComposePayload({
      title: 'Bleed intent',
      slides: [{ _type: 'Slide', children: [
        { _type: 'Shape', role: 'decoration', bleed: 0.2, x: -0.1, y: 1, width: 2, height: 1, fill: '#123456' },
        { _type: 'Shape', role: 'background', x: -0.3, y: 3, width: 2, height: 1, fill: '#654321' },
        { _type: 'Shape', role: 'decoration', x: 9.8, y: 1, width: 1, height: 1, fill: '#123456' },
        { _type: 'Shape', x: 9.8, y: 3, width: 1, height: 1, fill: '#654321' },
      ] }],
    });
    if (!compiled.ok) throw new Error(compiled.message);
    const parsed = readCompiledDirectComposeInput(compiled.input);
    if (!parsed.input) throw new Error(parsed.error);
    const deck = buildDeckSpecFromDirectInput(parsed.input);
    const slide = mapGeneratedSlide(deck.slides[0], 0, resolveRenderDefaults(deck.theme), new Map());
    expect(isSlideRenderModel(slide)).toBe(true);
    expect(slide.elements[0].editableTarget?.semanticRole).toBe('decoration');
    const model: PresentationRenderModel = {
      presentationId: 'test', version: 1, title: 'Bleed intent', sourceKind: 'generated',
      slideSize: { width: 10, height: 5.625, unit: 'in' }, slides: [slide],
      capabilities: { hasSemanticRender: true, hasReferencePreview: false, hasHitTest: true, hasSelection: true },
    };
    const info = renderModelToLintInfo(model);
    const bounds = new LayoutLint().lint(info).issues.filter(issue => issue.code === 'out_of_bounds');
    expect(bounds.map(issue => issue.severity)).toEqual(['info', 'info', 'warning']);

    // 只验证 producer 会漏掉 registry 漂移；必须穿过 Agent/CLI 共用的最终准入边界。
    const spatial = new SpatialAnalyzer();
    const feedback = await buildToolFeedbackPayload('test', 'revision-1', model, new Map(), {
      spatialAnalyzer: { analyzeSpatial: async ({ slideNodes }) => spatial.analyze([...slideNodes]) },
    });
    expect(feedback.buildStatus.state).toBe('ready');
    const findings = feedback.findings.filter(finding => finding.code === 'out_of_bounds');
    expect(findings.map(finding => finding.severity)).toEqual(['info', 'info', 'warning']);
    expect(findings.map(classifyDiagnosticPriority)).toEqual(['P2', 'P2', 'P0']);
    expect(findings.map(finding => finding.evidence.node.nodeId)).toEqual(slide.elements.slice(1).map(node => node.id));
    expect(findings.map(finding => finding.evidence.violatedSides)).toEqual([['left'], ['right'], ['right']]);
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
