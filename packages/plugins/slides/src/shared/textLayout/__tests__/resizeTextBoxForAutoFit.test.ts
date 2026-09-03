import { describe, expect, it } from 'vitest';
import { resizeTextBoxForAutoFit } from '../functions/resizeTextBoxForAutoFit';

describe('resizeTextBoxForAutoFit', () => {
  it.each([
    ['top', 2],
    ['middle', 1.5],
    ['bottom', 1],
  ] as const)('preserves the %s vertical anchor while growing', (verticalAlign, expectedY) => {
    const box = { x: 1, y: 2, w: 3, h: 1, unit: 'in' as const };

    expect(resizeTextBoxForAutoFit(box, 2, verticalAlign)).toEqual({
      x: 1,
      y: expectedY,
      w: 3,
      h: 2,
      unit: 'in',
    });
  });

  it('preserves the original box when the text already fits', () => {
    const box = { x: 1, y: 2, w: 3, h: 2, unit: 'in' as const };

    expect(resizeTextBoxForAutoFit(box, 1.5, 'middle')).toBe(box);
  });
});
