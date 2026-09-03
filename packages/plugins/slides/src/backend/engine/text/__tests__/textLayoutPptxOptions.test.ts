import { describe, expect, it } from 'vitest';
import type { TextLayoutContract } from '@plugin/slides/shared';
import { mapTextLayoutContractToPptxTextOptions } from '../textLayoutPptxOptions.js';

function contract(overrides: Partial<TextLayoutContract> = {}): TextLayoutContract {
  return {
    profile: 'plain-textbox',
    sourceKind: 'generated',
    box: { x: 1, y: 1, w: 3, h: 1 },
    padding: { top: 0.05, right: 0.1, bottom: 0.05, left: 0.1 },
    wrap: 'word',
    lineBreak: 'office-compatible',
    autoFitPolicy: 'resize-shape',
    overflow: 'clip',
    verticalAlign: 'top',
    font: {},
    ...overrides,
  };
}

describe('mapTextLayoutContractToPptxTextOptions', () => {
  it('maps resize-shape contract to pptx fit/wrap/margin options', () => {
    expect(mapTextLayoutContractToPptxTextOptions(contract())).toEqual({
      fit: 'resize',
      wrap: true,
      margin: [7.2, 7.2, 3.6, 3.6],
    });
  });

  it('maps shrink-text and wrap none without reinterpreting padding', () => {
    expect(mapTextLayoutContractToPptxTextOptions(contract({
      autoFitPolicy: 'shrink-text',
      wrap: 'none',
      padding: { top: 0, right: 0.2, bottom: 0.3, left: 0.4 },
    }))).toEqual({
      fit: 'shrink',
      wrap: false,
      margin: [28.8, 14.4, 21.6, 0],
    });
  });
});
