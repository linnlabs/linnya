import { describe, expect, it } from 'vitest';
import type { SvgGraphicRenderNode } from '../../../types/render';
import {
  resolveSvgGraphicFitConfig,
  svgGraphicDataUri,
} from './svgGraphicKonva';

const node: SvgGraphicRenderNode = {
  id: 'svg-1',
  kind: 'svgGraphic',
  box: { x: 1, y: 1, w: 4, h: 4, unit: 'in' },
  zIndex: 0,
  canonicalSvg: '<svg viewBox="0 0 100 50"><path d="M0 0L100 50"/></svg>',
  contentHash: 'e'.repeat(64),
  viewBox: { width: 100, height: 50 },
  fit: 'contain',
  decorative: true,
};

describe('SVG Graphic Konva rendering', () => {
  it('把 canonical SVG 编码为自包含资源，不读取文件或网络', () => {
    const uri = svgGraphicDataUri(node);
    expect(uri).toMatch(/^data:image\/svg\+xml;charset=utf-8,/u);
    expect(decodeURIComponent(uri.split(',')[1] ?? '')).toBe(node.canonicalSvg);
  });

  it('contain 使用 viewBox 比例居中，stretch 才铺满整个 frame', () => {
    expect(resolveSvgGraphicFitConfig(node)).toMatchObject({
      x: 0,
      y: 96,
      width: 384,
      height: 192,
    });
    expect(resolveSvgGraphicFitConfig({ ...node, fit: 'stretch' })).toMatchObject({
      x: 0,
      y: 0,
      width: 384,
      height: 384,
    });
  });
});
