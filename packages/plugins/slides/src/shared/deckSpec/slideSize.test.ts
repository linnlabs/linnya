import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SLIDE_LAYOUT,
  createPptxCustomLayoutName,
  createSlideLayoutKey,
  normalizeSlideLayout,
  requireNormalizedSlideLayout,
  resolveSlideSizeBoxInches,
  resolveSlideSizeInches,
  toSlideSizeEmu,
  toRenderSlideSize,
  toSlideSizeBox,
} from './slideSize';

describe('slide size shared contract', () => {
  it('uses 16x9 as the default slide layout', () => {
    expect(DEFAULT_SLIDE_LAYOUT).toBe('16x9');
    expect(resolveSlideSizeInches(undefined)).toEqual({ width: 10, height: 5.625 });
  });

  it.each([
    ['16x9', { width: 10, height: 5.625 }],
    ['16x10', { width: 10, height: 6.25 }],
    ['4x3', { width: 10, height: 7.5 }],
  ] as const)('resolves %s to canonical inches', (layout, expected) => {
    expect(resolveSlideSizeInches(layout)).toEqual(expected);
  });

  it('converts canonical size to Box and render-model shapes explicitly', () => {
    const size = resolveSlideSizeInches('16x10');

    expect(toSlideSizeBox(size)).toEqual({ w: 10, h: 6.25 });
    expect(resolveSlideSizeBoxInches('4x3')).toEqual({ w: 10, h: 7.5 });
    expect(toRenderSlideSize(size)).toEqual({ width: 10, height: 6.25, unit: 'in' });
  });

  it('normalizes custom inches through the integer EMU identity', () => {
    const normalized = requireNormalizedSlideLayout({
      width: 10.0000001,
      height: 5.625,
      unit: 'in',
    });

    expect(normalized).toEqual({ width: 10, height: 5.625, unit: 'in' });
    expect(resolveSlideSizeInches(normalized)).toEqual({ width: 10, height: 5.625 });
    expect(toSlideSizeEmu(resolveSlideSizeInches(normalized))).toEqual({
      cx: 9_144_000,
      cy: 5_143_500,
    });
    expect(createSlideLayoutKey(normalized)).toBe('custom:9144000x5143500');
    expect(createPptxCustomLayoutName(normalized)).toBe('LINNYA_9144000_5143500');
  });

  it.each([
    { width: 1, height: 56, unit: 'in' },
    { width: 56, height: 1, unit: 'in' },
    { width: 1, height: 1, unit: 'in' },
  ] as const)('accepts the PowerPoint document-size boundary $width×$height', (layout) => {
    expect(normalizeSlideLayout(layout)).toEqual({ value: layout });
  });

  it.each([
    [{ width: 0, height: 10, unit: 'in' }, 'layout.width'],
    [{ width: 10, height: 57, unit: 'in' }, 'layout.height'],
    [{ width: Number.NaN, height: 10, unit: 'in' }, 'layout.width'],
    [{ width: 10, height: 10, unit: 'cm' }, 'layout.unit'],
    [{ width: 10, height: 10, unit: 'in', ratio: '1:1' }, '只能包含'],
    ['9x16', 'layout 必须'],
  ])('rejects an invalid custom layout', (layout, expected) => {
    expect(normalizeSlideLayout(layout)).toEqual({ error: expect.stringContaining(expected) });
  });
});
