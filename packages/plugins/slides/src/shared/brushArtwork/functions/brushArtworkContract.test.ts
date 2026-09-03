import { describe, expect, it } from 'vitest';
import {
  normalizeBrushArtworkSourceRef,
  resolveBrushArtworkPixelSize,
} from './brushArtworkContract';

describe('Brush artwork authoring contract', () => {
  it('规范化声明式图层的颜色和缺省值，并拒绝旧 recipe 字段', () => {
    const source = normalizeBrushArtworkSourceRef({
      kind: 'brush_artwork',
      seed: 42,
      backgroundColor: '#fffdf8',
      layers: [{
        stroke: { brush: 'HB', color: '#223344' },
        fill: { kind: 'watercolor', color: '#aa3322' },
        marks: [{ type: 'ellipse', center: [50, 50], radiusX: 24, radiusY: 18 }],
      }],
    });
    expect(source).toEqual({
      kind: 'brush_artwork',
      seed: 42,
      backgroundColor: '#FFFDF8',
      quality: 'standard',
      layers: [{
        stroke: { brush: 'HB', color: '#223344', weight: 1 },
        fill: {
          kind: 'watercolor',
          color: '#AA3322',
          opacity: 150,
          bleed: 0.07,
          bleedDirection: 'out',
          texture: 0.8,
          border: 0.5,
          scatter: true,
        },
        marks: [{
          type: 'ellipse',
          center: [50, 50],
          radiusX: 24,
          radiusY: 18,
          irregularity: 0,
        }],
      }],
    });
    expect(() => normalizeBrushArtworkSourceRef({
      ...source,
      recipe: 'watercolor_wash',
    })).toThrow('unsupported fields');
  });

  it('拒绝无可见 stroke 的开放路径与超出总点数预算的作品', () => {
    expect(() => normalizeBrushArtworkSourceRef({
      kind: 'brush_artwork',
      seed: 1,
      backgroundColor: '#FFFFFF',
      layers: [{
        fill: { kind: 'wash', color: '#112233' },
        marks: [{ type: 'line', from: [0, 0], to: [100, 100] }],
      }],
    })).toThrow('needs a stroke for open marks');

    expect(() => normalizeBrushArtworkSourceRef({
      kind: 'brush_artwork',
      seed: 1,
      backgroundColor: '#FFFFFF',
      layers: [{
        stroke: { brush: 'pen', color: '#112233' },
        marks: [{
          type: 'spline',
          points: Array.from({ length: 4097 }, () => [50, 50]),
        }],
      }],
    })).toThrow('cannot exceed 4096 points');
  });

  it('从物理盒和质量档派生像素尺寸，并对极端画布等比收敛预算', () => {
    const intent = normalizeBrushArtworkSourceRef({
      kind: 'brush_artwork',
      seed: 7,
      backgroundColor: '#F8EED8',
      quality: 'high',
      layers: [{
        stroke: { brush: 'charcoal', color: '#112233' },
        marks: [{ type: 'line', from: [5, 50], to: [95, 50] }],
      }],
    });
    expect(resolveBrushArtworkPixelSize(intent, { width: 10, height: 5 })).toEqual({
      widthPx: 2160,
      heightPx: 1080,
    });
    const extreme = resolveBrushArtworkPixelSize(intent, { width: 56, height: 1 });
    expect(extreme.widthPx).toBe(4096);
    expect(extreme.heightPx).toBeGreaterThan(0);
    expect(extreme.widthPx * extreme.heightPx).toBeLessThanOrEqual(12_000_000);
  });
});
