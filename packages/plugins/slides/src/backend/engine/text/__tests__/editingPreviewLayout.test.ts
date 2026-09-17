import { describe, expect, it } from 'vitest';
import { projectFontUnitAdvances } from '@linnya/text-measurement-core';
import type { FontMetricsProvider, RunAdvanceProvider, PresentationRenderModel, TextRenderNode } from '@plugin/slides/shared';
import { isSlideRenderModel, findSlideRenderModelFailurePath } from '@plugin/slides/shared/renderModel';
import { projectEditingPreviewNode, collectEditingPreviewGeometries, type EditingVisualPreview } from '../../../../renderer/features/editingPreview';
import { applyTextLayoutToRenderModel } from '../renderModelTextLayout';

const provider: RunAdvanceProvider = { getClusterAdvances(clusters, style) {
  const fontUnits = { unitsPerEm: 1000, advances: clusters.map((_, i) => i % 3 === 0 ? 721 : 439) };
  return { source: 'harfbuzz', fontUnits, advances: projectFontUnitAdvances(fontUnits, style.fontSizePt, style.letterSpacingPt) };
} };
const metrics: FontMetricsProvider = {
  getMetrics: style => ({ ascent: 0.8 * (style.fontSizePt / 72), descent: 0.2 * (style.fontSizePt / 72), lineGap: 0 }),
  getMetricsInEm: () => ({ ascent: 0.8, descent: 0.2, lineGap: 0 }),
};
function input(overrides: Partial<TextRenderNode> = {}): TextRenderNode {
  return { id: 'text', kind: 'text', zIndex: 0, box: { x: 1, y: 1, w: 2, h: 0.5, unit: 'in' },
    authoringRef: { slideKey: 's', editKey: 't', targetKind: 'text' },
    authoringEdit: { capabilities: ['translate', 'set_text_style', 'set_text_content'], text: { kind: 'rich_text', content: [{ text: 'ABCD ' }, { text: 'EFGH' }] } },
    paragraphs: [{ runs: [{ text: 'ABCD ', fontSize: 14, letterSpacing: 0.75 }, { text: 'EFGH', fontSize: 14 }] }],
    autoFitPolicy: 'resize-shape', verticalAlign: 'middle', wrap: 'word', overflow: 'clip', ...overrides };
}
function finalize(node: TextRenderNode): TextRenderNode {
  const model: PresentationRenderModel = { presentationId: 'p', title: 'test', version: 1, sourceKind: 'generated',
    slideSize: { width: 10, height: 5.625, unit: 'in' }, capabilities: { hasSemanticRender: true, hasReferencePreview: false, hasHitTest: true, hasSelection: true },
    slides: [{ slideId: 's', index: 0, layoutKey: 'blank', background: { paint: { type: 'solid', color: '#FFFFFF' } }, elements: [node] }] };
  applyTextLayoutToRenderModel(model, provider, metrics);
  const wire: unknown = JSON.parse(JSON.stringify(model.slides[0]));
  if (!isSlideRenderModel(wire)) throw new Error(`Invalid prepared layout transport: ${findSlideRenderModelFailurePath(wire)}`);
  const result = wire.elements[0];
  if (result.kind !== 'text') throw new Error('Missing text');
  return result;
}
function style(fontSizePt: number): EditingVisualPreview {
  return { elementId: 'text', affectedElementIds: ['text'], operation: {
    op: 'set_text_style', target: { slideKey: 's', editKey: 't' }, fontSizePt,
  } };
}
function resized(node: TextRenderNode, fontSize: number): TextRenderNode {
  return { ...node, paragraphs: node.paragraphs.map(p => ({ ...p, runs: p.runs.map(run => 'text' in run ? { ...run, fontSize } : run) })) };
}

describe('editing preview and finalized layout handoff', () => {
  it('updates font, run positions, line breaks, autofit and geometry together across large and fractional changes', () => {
    for (const autoFitPolicy of ['none', 'shrink-text', 'resize-shape'] as const) {
      for (const align of ['left', 'center', 'right'] as const) {
        const source = input({ autoFitPolicy });
        source.paragraphs[0].align = align;
        const baseline = finalize(structuredClone(source));
        const original = structuredClone(baseline);
        const pending: EditingVisualPreview[] = [];
        for (const fontSize of [48, 8.25, 96, 18.5]) {
          pending.push(style(fontSize));
          const preview = projectEditingPreviewNode(baseline, [...pending]);
          const final = finalize(resized(structuredClone(source), fontSize));
          expect(preview.kind).toBe('text');
          if (preview.kind !== 'text') throw new Error('Missing text preview');
          expect(preview.layout).toEqual(final.layout);
          expect(preview.paragraphs).toEqual(final.paragraphs);
          expect(preview.box).toEqual(final.box);
          expect(collectEditingPreviewGeometries([baseline], pending).get('text')?.node).toBe(preview);
          expect(collectEditingPreviewGeometries([baseline], pending).get('text')?.polygon)
            .toEqual(collectEditingPreviewGeometries([final], []).get('text')?.polygon);
        }
        expect(baseline).toEqual(original);
        expect(baseline.preparedTextLayout?.advances).toHaveLength(0);
        expect(baseline.preparedTextLayout?.fontUnits).toHaveLength(2);
        expect(baseline.preparedTextLayout?.metricsInEm).toHaveLength(2);
        expect(projectEditingPreviewNode(baseline, [])).toBe(baseline);
      }
    }
  });

  it('retains the complete previous frame when an author layout subtree must be recomputed', () => {
    const baseline = finalize(input());
    baseline.layoutConstraintEvidence = { layoutNodeId: 'layout', positionMode: 'flow',
      declared: {}, finalBox: baseline.box, computedRatios: {}, clipSemantics: 'visible',
      parent: { nodeId: 'parent', kind: 'layout_container', label: 'parent', zIndex: -1, finalBox: baseline.box } };
    expect(projectEditingPreviewNode(baseline, [style(48)])).toBe(baseline);
    baseline.layoutConstraintEvidence = { ...baseline.layoutConstraintEvidence, positionMode: 'absolute' };
    expect(projectEditingPreviewNode(baseline, [style(48)])).toBe(baseline);
    baseline.layoutConstraintEvidence = { ...baseline.layoutConstraintEvidence, declared: { widthInches: 2, heightInches: 0.5 } };
    expect(projectEditingPreviewNode(baseline, [style(48)])).not.toBe(baseline);
  });

  it('does not publish mixed old geometry/new styling for unavailable font facts, while paint needs no layout', () => {
    const baseline = finalize(input());
    if (!baseline.preparedTextLayout) throw new Error('Missing prepared layout');
    baseline.preparedTextLayout = { ...baseline.preparedTextLayout, fontUnits: [] };
    expect(projectEditingPreviewNode(baseline, [style(48)])).toBe(baseline);
    const paint: EditingVisualPreview = { ...style(48), operation: { op: 'set_text_style', target: { slideKey: 's', editKey: 't' }, color: '#FF0000' } };
    const preview = projectEditingPreviewNode(baseline, [paint]);
    if (preview.kind !== 'text') throw new Error('Missing text preview');
    expect(preview.layout).toBe(baseline.layout);
    expect(preview.paragraphs[0].runs[0]).toMatchObject({ color: '#FF0000', fontSize: 14 });
  });
});
