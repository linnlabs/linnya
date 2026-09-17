import type { FontUnitAdvances } from '../definitions/types.js';

/** 只在投影到目标字号后取整；不能把已经取整的英寸宽度再次缩放。 */
export function projectFontUnitAdvances(
  facts: FontUnitAdvances,
  fontSizePt: number,
  letterSpacingPt = 0,
): number[] {
  return facts.advances.map((advance, index) => Number((
    advance / facts.unitsPerEm * (fontSizePt / 72)
    + (index > 0 ? letterSpacingPt / 72 : 0)
  ).toFixed(6)));
}
