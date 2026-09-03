import { describe, expect, it } from 'vitest';
import type { MathFormulaRenderNode } from '../../../types/render';
import { formulaDataUri, resolveFormulaPlacement } from './formulaKonva';

const node: MathFormulaRenderNode = {
  id: 'formula-1',
  kind: 'formula',
  box: { x: 1, y: 1, w: 4, h: 1.5, unit: 'in' },
  zIndex: 0,
  canonicalSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 216 116"></svg>',
  contentHash: 'a'.repeat(64),
  viewBox: { x: 0, y: 0, width: 216, height: 116 },
  contentViewBox: { x: 8, y: 8, width: 200, height: 100 },
  metrics: {
    advanceWidth: 1,
    ascent: 0.4,
    descent: 0.2,
    inkBounds: { x: 0, y: -0.4, width: 1, height: 0.6 },
    nativeEnvelope: { ascentEm: 0.8, descentEm: 0.2 },
  },
  altText: '求根公式',
  align: 'right',
};

describe('formula Konva projection', () => {
  it('使用自包含 SVG，并按原生字号落在公式框右侧而非放大铺满', () => {
    expect(decodeURIComponent(formulaDataUri(node))).toContain('<svg');
    const config = resolveFormulaPlacement(node);
    expect(config.width).toBeLessThan(node.box.w * 96);
    const scale = config.width / node.viewBox.width;
    const contentRight = config.x
      + (node.contentViewBox.x + node.contentViewBox.width) * scale;
    expect(contentRight).toBeCloseTo(node.box.w * 96);
  });

  it('按 viewBox 相对偏移放置带负坐标的数学排版 SVG', () => {
    const mathJaxNode: MathFormulaRenderNode = {
      ...node,
      align: 'left',
      viewBox: { x: -80, y: -898.4, width: 3742.6, height: 990.4 },
      contentViewBox: { x: 0, y: -818.4, width: 3582.6, height: 830.4 },
      metrics: {
        ...node.metrics,
        advanceWidth: 1.6,
      },
    };
    const config = resolveFormulaPlacement(mathJaxNode);
    const scale = config.width / mathJaxNode.viewBox.width;
    const contentLeft = config.x
      + (mathJaxNode.contentViewBox.x - mathJaxNode.viewBox.x) * scale;
    expect(contentLeft).toBeCloseTo(0);
  });
});
