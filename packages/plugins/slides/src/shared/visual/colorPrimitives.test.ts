import { describe, expect, it } from 'vitest';

import {
  assertCanonicalHexColor,
  normalizeFillColor,
  normalizeOpaqueColor,
  toPptxHexColor,
} from './colorPrimitives';

describe('color primitives', () => {
  it('normalizes supported opaque color literals to canonical hex', () => {
    expect(normalizeOpaqueColor('#abc', 'fill')).toEqual({ value: '#AABBCC' });
    expect(normalizeOpaqueColor('336699', 'fill')).toEqual({ value: '#336699' });
    expect(normalizeOpaqueColor('rgb(12, 34, 56)', 'fill')).toEqual({ value: '#0C2238' });
    expect(normalizeOpaqueColor('rgba(12, 34, 56, 1)', 'fill')).toEqual({ value: '#0C2238' });
  });

  it('keeps rgba alpha only when it agrees with the opacity field', () => {
    expect(normalizeFillColor('rgba(12, 34, 56, 0.4)', 'shape.fill')).toEqual({
      value: { color: '#0C2238', opacity: 0.4 },
    });
    expect(normalizeFillColor('rgba(12, 34, 56, 0.4)', 'shape.fill', 0.4)).toEqual({
      value: { color: '#0C2238', opacity: 0.4 },
    });
    expect(normalizeFillColor('rgba(12, 34, 56, 0.4)', 'shape.fill', 0.5)).toEqual({
      error: 'shape.fill 同时提供了 rgba alpha 和独立透明度字段，语义冲突。',
    });
  });

  it('rejects transparent colors where only opaque color fields are allowed', () => {
    expect(normalizeOpaqueColor('rgba(12, 34, 56, 0.4)', 'text.color')).toEqual({
      error: 'text.color 不支持带 alpha 的颜色；请改用 #RRGGBB 和独立透明度字段。',
    });
  });

  it('converts canonical hex colors to PPTX hex payloads', () => {
    expect(assertCanonicalHexColor('#abc', 'shape.fill')).toBe('#AABBCC');
    expect(toPptxHexColor('#AABBCC', 'shape.fill')).toBe('AABBCC');
  });
});
