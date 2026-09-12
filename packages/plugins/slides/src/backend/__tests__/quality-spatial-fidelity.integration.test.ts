import { describe, expect, it } from 'vitest';
import type { DeckSpec, RunAdvanceProvider } from '@plugin/slides/shared';
import { RenderModelMapper } from '../engine/parser/RenderModelMapper';
import { applyTextLayoutToRenderModel } from '../engine/text/renderModelTextLayout';
import { applyFreeformTransform, toLocalFreeformBox } from '../engine/shared/freeformTransform';
import { SpatialAnalyzer } from '../engine/quality/SpatialAnalyzer';
import { classifyOverlap } from '../engine/quality/SpatialSemantics';
import { buildToolFeedbackPayload } from '../tools/inspectFeedback/feedbackPayload';
import { classifyDiagnosticPriority } from '../engine/quality/definitions';

// 注入可复算的字距 port，覆盖 mapper → finalization → strict finding，
// 而不是让同一个估算器同时制造输入盒与测试结论。
const advance = 0.0731234;
const provider: RunAdvanceProvider = {
  getClusterAdvances: clusters => ({ advances: clusters.map(() => advance), source: 'pretext' }),
};

async function inspect(deck: DeckSpec) {
  const model = new RenderModelMapper().fromGeneratedDeck('geometry-fidelity', 1, deck.title, deck, {
    width: 10, height: 5.625,
  });
  applyTextLayoutToRenderModel(model, provider);
  const spatial = new SpatialAnalyzer();
  const feedback = await buildToolFeedbackPayload('geometry-fidelity', 'revision-1', model, new Map(), {
    spatialAnalyzer: { analyzeSpatial: async ({ slideNodes }) => spatial.analyze([...slideNodes]) },
  });
  return { model, feedback };
}

describe('quality geometry provenance', () => {
  it('preserves intrinsic freeform width without suppressing genuine small overflow', async () => {
    const content = 'Reproducible label';
    const measuredWidth = content.length * advance + 0.2;
    const width = Math.ceil(measuredWidth * 914400) / 914400;
    const deck: DeckSpec = {
      title: 'Intrinsic width boundary', layout: '16x9',
      slides: [{ slideNumber: 1, spec: { type: 'freeform', elements: [
        { type: 'text', content, textWrap: 'none',
          position: { x: 0.432198, y: 1.234567, w: width, h: 0.4 },
          style: { fontSize: 9 } },
        // 独立负例：明确短于测量值，即使小于旧 round3 的步长也必须如实报告。
        { type: 'text', content, textWrap: 'none',
          position: { x: 0.432198, y: 2.234567, w: measuredWidth - 0.0002, h: 0.4 },
          style: { fontSize: 9 } },
      ] } }],
    };
    const { model, feedback } = await inspect(deck);
    const [fitting, narrow] = model.slides[0]!.elements;
    expect(fitting?.box.w).toBe(width);
    if (fitting?.kind !== 'text' || narrow?.kind !== 'text') throw new Error('Expected text nodes');
    expect(fitting.layout?.overflow.horizontal).toBe(false);
    expect(narrow.layout?.overflow.horizontal).toBe(true);
    const overflow = feedback.findings.filter(finding => finding.code === 'text_overflow_risk');
    expect(overflow).toHaveLength(1);
    expect(overflow[0]?.evidence.node.nodeId).toBe(narrow.id);
    expect(classifyDiagnosticPriority(overflow[0]!)).toBe('P0');

    const transform = { offsetX: 0.293827, offsetY: 0.712934, scaleX: 1.25, scaleY: 0.8 };
    const original = { x: 0.432198, y: 1.234567, w: width, h: 0.412387 };
    const global = applyFreeformTransform(original, transform);
    const local = toLocalFreeformBox(original, global, transform);
    expect(local.x).toBeCloseTo(original.x, 12);
    expect(local.y).toBeCloseTo(original.y, 12);
    expect(local.w).toBeCloseTo(original.w, 12);
    expect(local.h).toBeCloseTo(original.h, 12);
  });

  it('does not call shared decorative path viewBoxes a positioning failure, but keeps stacked text actionable', async () => {
    const pathElements = [0, 1, 2].map(index => ({
      type: 'shape' as const,
      position: { x: 1, y: 1, w: 6, h: 3 },
      _semanticRole: 'decoration',
      geometry: {
        type: 'path' as const,
        viewBox: { width: 600, height: 300 },
        commands: [
          { type: 'moveTo' as const, x: 0, y: index * 80 },
          { type: 'lineTo' as const, x: 600, y: index * 80 },
          { type: 'lineTo' as const, x: 600, y: index * 80 + 40 },
          { type: 'lineTo' as const, x: 0, y: index * 80 + 40 },
          { type: 'close' as const },
        ],
      },
      style: { fill: '#547392' },
    }));
    const { feedback } = await inspect({
      title: 'Semantic geometry', layout: '16x9', slides: [
        { slideNumber: 1, spec: { type: 'structured', elements: pathElements } },
        { slideNumber: 2, spec: { type: 'structured', elements: ['Alpha', 'Beta', 'Gamma'].map(content => ({
          type: 'text', content, position: { x: 1, y: 1, w: 3, h: 0.4 }, style: { fontSize: 10 },
        })) } },
      ],
    });
    const stacking = feedback.findings.filter(finding => finding.code === 'origin_stacking');
    expect(stacking).toHaveLength(1);
    expect(stacking[0]?.slides).toEqual([2]);
    expect(stacking[0]?.evidence.nodes).toHaveLength(3);
    expect(classifyDiagnosticPriority(stacking[0]!)).toBe('P0');
  });

  it('retains table/footer overlap evidence without treating narrow text as decoration', async () => {
    const { feedback } = await inspect({
      title: 'Table and footer', layout: '16x9', slides: [{ slideNumber: 1, spec: {
        type: 'structured', elements: [
          { type: 'text', content: 'Synthetic data only', _semanticRole: 'footnote',
            position: { x: 0.5, y: 4.95, w: 4, h: 0.25 }, style: { fontSize: 8 } },
          { type: 'table', position: { x: 0.5, y: 1, w: 6, h: 4.1 },
            rows: [[{ text: 'Measured', fill: '#FFFFFF' }]] },
        ],
      } }],
    });
    const overlap = feedback.findings.find(finding => finding.code === 'element_overlap');
    expect(overlap?.evidence.nodes.map(node => node.kind).sort()).toEqual(['table', 'text']);
    expect(overlap?.confidence).toBe('medium');
    expect(overlap?.remediation.disposition).toBe('review');
    expect(classifyDiagnosticPriority(overlap!)).toBe('P2');

    expect(classifyOverlap(
      { kind: 'text', box: { x: 0.5, y: 4.95, w: 4, h: 0.1 }, semanticRole: 'footnote' },
      { kind: 'table', box: { x: 0.5, y: 1, w: 6, h: 4.1 } },
    )).toBe('forbidden');
    expect(classifyOverlap(
      { kind: 'shape', box: { x: 0.5, y: 4.95, w: 4, h: 0.02 }, semanticRole: 'decoration' },
      { kind: 'table', box: { x: 0.5, y: 1, w: 6, h: 4.1 } },
    )).toBe('decorative');
  });
});
