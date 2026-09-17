import { describe, expect, it } from 'vitest';
import type { TextRenderNode } from '../../renderModel';
import type { FontMetricsProvider, RunAdvanceProvider } from '../definitions/types';
import { prepareTextLayout, layoutPreparedText } from '../functions/preparedTextLayout';
import { layoutTextNode } from '../orchestration/layoutTextNode';
import { resolveTextLayoutContractFromNode } from '../functions/resolveTextLayoutContract';

const node: TextRenderNode = {
  id: 'shape-text', kind: 'text', zIndex: 0, box: { x: 0, y: 0, w: 4, h: 2, unit: 'in' },
  paragraphs: [{ align: 'center', runs: [{ text: 'AVAV ffi 中文换行\n第二行', fontSize: 24, fontFamily: 'Test' }] },
    { runs: [{ text: '', fontSize: 18 }] }],
  autoFitPolicy: 'shrink-text', overflow: 'clip', verticalAlign: 'middle', wrap: 'word',
};
const provider: RunAdvanceProvider = { getClusterAdvances(clusters, style) {
  // 同一个字符在不同位置故意返回不同值，防止按单字去重破坏 shaping 上下文。
  return { advances: clusters.map((_, index) => style.fontSizePt / 72 * (index % 3 === 0 ? 0.7 : 0.4)), source: 'harfbuzz' };
} };
const metrics: FontMetricsProvider = { getMetrics: style => ({ ascent: style.fontSizePt / 90, descent: style.fontSizePt / 360, lineGap: 0 }) };

describe('prepared shape text layout', () => {
  it('uses identical advances, wrapping and autofit before and after compilation at every resize size', () => {
    const prepared = prepareTextLayout(node, 'generated', 'Test', provider, metrics);
    const scales = new Set<number>();
    for (const [w, h] of [[4, 2], [1, 0.4], [2, 0.8], [0.5, 0.2], [5, 3], [1.25, 0.6]]) {
      const resized = { ...node, box: { ...node.box, w, h } };
      const preview = layoutPreparedText(resized, prepared);
      const committed = layoutTextNode({ paragraphs: resized.paragraphs, defaultFontFamily: 'Test',
        contract: resolveTextLayoutContractFromNode(resized, { sourceKind: 'generated', profile: 'shape-inner-text' }),
      }, provider, metrics);
      expect(preview).toEqual(committed);
      scales.add(preview.appliedFontScale);
    }
    expect(scales.size).toBeGreaterThan(1);
  });

  it('rejects stale text rather than silently estimating new glyph measurements', () => {
    const prepared = prepareTextLayout(node, 'generated', 'Test', provider, metrics);
    expect(() => layoutPreparedText({ ...node, paragraphs: [{ runs: [{ text: 'changed', fontSize: 24 }] }] }, prepared))
      .toThrow('Missing prepared text advances');
  });
});
