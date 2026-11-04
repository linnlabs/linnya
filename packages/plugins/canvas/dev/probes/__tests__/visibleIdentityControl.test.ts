import { expect, it } from 'vitest';
import { readCanvasElementText } from '../../../src/shared';
import { changeVisibleUpdateFixture, createVisibleUpdateFixture, visibleUpdateChangedFirstLines } from '../visibleUpdateFixture';

it('gives both arms identical before bodies, with500 new revisions but different first-line changes', () => {
  const beforeA = createVisibleUpdateFixture('identity-control'), beforeB = createVisibleUpdateFixture('identity-control');
  expect(beforeA).toEqual(beforeB);
  const afterA = changeVisibleUpdateFixture(beforeA, 'identity-control', 21, 'changing');
  const afterB = changeVisibleUpdateFixture(beforeB, 'identity-control', 21, 'stable');
  expect(visibleUpdateChangedFirstLines(beforeA, afterA)).toBe(500);
  expect(visibleUpdateChangedFirstLines(beforeB, afterB)).toBe(0);
  afterB.forEach((card, i) => {
    const suffix = String(i + 1).padStart(3, '0');
    expect(readCanvasElementText(beforeA[i])).toBe(`20:${suffix}\n20:${suffix}`);
    expect(readCanvasElementText(afterA[i])).toBe(`21:${suffix}\n21:${suffix}`);
    expect(readCanvasElementText(card)).toBe(`20:${suffix}\n21:${suffix}`);
    expect(card.revision).toBe(2); expect(afterA[i].revision).toBe(2);
    expect(card.data.content).not.toEqual(beforeB[i].data.content);
    expect(card.data.heightMode).toBe('fixed');
  });
});
