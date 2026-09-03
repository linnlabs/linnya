import { describe, expect, it } from 'vitest';

import { isGeneratedLayoutConstraintEvidence } from './isGeneratedLayoutConstraintEvidence';

const VALID_EVIDENCE = {
  layoutNodeId: 'layout:s1:root.0',
  positionMode: 'flow',
  declared: { widthInches: 4 },
  finalBox: { x: 0, y: 0, w: 4, h: 1, unit: 'in' },
  computedRatios: { widthToDeclared: 1 },
  parent: {
    nodeId: 'layout:s1:root',
    kind: 'slide',
    label: 'Slide',
    finalBox: { x: 0, y: 0, w: 10, h: 5.625, unit: 'in' },
    zIndex: -1,
  },
  clipSemantics: 'visible',
};

describe('isGeneratedLayoutConstraintEvidence', () => {
  it('accepts canonical generated facts and rejects forged or malformed fields', () => {
    expect(isGeneratedLayoutConstraintEvidence(VALID_EVIDENCE)).toBe(true);
    expect(isGeneratedLayoutConstraintEvidence({
      ...VALID_EVIDENCE,
      authorSource: 'must not cross the contract',
    })).toBe(false);
    expect(isGeneratedLayoutConstraintEvidence({
      ...VALID_EVIDENCE,
      computedRatios: { widthToDeclared: -1 },
    })).toBe(false);
  });
});
