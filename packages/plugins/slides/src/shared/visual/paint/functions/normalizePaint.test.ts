import { describe, expect, it } from 'vitest';
import {
  normalizeGradientPaint,
  normalizeShapeFillInput,
  normalizeStrokePaint,
} from './normalizePaint';

describe('Slides Paint 归一化', () => {
  it('接受多 stop linear gradient，并统一角度、颜色和默认旋转语义', () => {
    const result = normalizeGradientPaint({
      type: 'linear',
      angle: -45,
      stops: [
        { color: '#123', position: 0 },
        { color: '#456789', position: 0.5, opacity: 0.4 },
        { color: '#ABCDEF', position: 1 },
      ],
    }, 'shape.fill');

    expect(result).toEqual({
      value: {
        type: 'linear',
        angle: 315,
        stops: [
          { color: '#112233', position: 0 },
          { color: '#456789', position: 0.5, opacity: 0.4 },
          { color: '#ABCDEF', position: 1 },
        ],
        rotateWithShape: true,
      },
    });
  });

  it('把 radial 的中心和半径补成确定默认值', () => {
    const result = normalizeGradientPaint({
      type: 'radial',
      stops: [
        { color: '#000000', position: 0 },
        { color: '#FFFFFF', position: 1 },
      ],
    }, 'shape.fill');

    expect(result).toMatchObject({
      value: {
        type: 'radial',
        center: { x: 0.5, y: 0.5 },
        radius: { x: 0.5, y: 0.5 },
      },
    });
  });

  it('拒绝 stop 乱序，避免各渲染端自行排序产生差异', () => {
    const result = normalizeGradientPaint({
      type: 'linear',
      angle: 0,
      stops: [
        { color: '#000000', position: 0.8 },
        { color: '#FFFFFF', position: 0.2 },
      ],
    }, 'shape.fill');

    expect(result).toEqual({
      error: 'shape.fill.stops[1].position 不能小于前一个 stop；请按 position 非递减排列。',
    });
  });

  it('兼容纯色和 transparency 对象，但输出统一 solid Paint', () => {
    expect(normalizeShapeFillInput('#123', 'shape.fill')).toEqual({
      value: { type: 'solid', color: '#112233' },
    });
    expect(normalizeShapeFillInput({ color: '#123456', transparency: 70 }, 'shape.fill')).toEqual({
      value: { type: 'solid', color: '#123456', opacity: 0.3 },
    });
  });

  it('stroke 明确拒绝 radial，而不是静默退化', () => {
    const result = normalizeStrokePaint({
      type: 'radial',
      stops: [
        { color: '#000000', position: 0 },
        { color: '#FFFFFF', position: 1 },
      ],
    }, 'shape.border.paint');

    expect(result).toEqual({
      error: 'shape.border.paint 暂不支持 radial stroke；请使用 linear gradient。',
    });
  });
});

