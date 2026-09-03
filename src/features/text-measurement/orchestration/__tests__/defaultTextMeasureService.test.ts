import { afterEach, describe, expect, it } from 'vitest';
import type { NormalizedTextMeasureInput, TextMeasureAdapter } from '../../definitions/types.js';
import {
  configureDefaultTextMeasureService,
  defaultTextMeasureService,
  resetDefaultTextMeasureServiceForTests,
} from '../defaultTextMeasureService.js';

class ConstantMeasureAdapter implements TextMeasureAdapter {
  readonly kind = 'constant-test';

  measure(_input: NormalizedTextMeasureInput) {
    return {
      lineCount: 7,
      contentHeightInches: 1.2,
      totalHeightInches: 1.4,
      maxLineWidthInches: 3.6,
      usedFallback: false,
      warnings: [],
      fitsWidth: true,
      fitsHeight: true,
    };
  }
}

afterEach(() => {
  resetDefaultTextMeasureServiceForTests();
});

describe('defaultTextMeasureService', () => {
  it('can be reconfigured by the host runtime', () => {
    configureDefaultTextMeasureService({
      primary: new ConstantMeasureAdapter(),
    });

    const measured = defaultTextMeasureService.measure({
      paragraphs: [{ text: 'Configured adapter' }],
      style: {
        fontSizePt: 11,
      },
      box: {
        widthInches: 2,
        wrap: 'word',
      },
      sourceKind: 'generated',
    });

    expect(measured.lineCount).toBe(7);
    expect(measured.usedFallback).toBe(false);
  });

  it('resets to the environment default adapter for tests', () => {
    configureDefaultTextMeasureService({
      primary: new ConstantMeasureAdapter(),
    });
    resetDefaultTextMeasureServiceForTests();

    const measured = defaultTextMeasureService.measure({
      paragraphs: [{ text: 'Reset adapter' }],
      style: {
        fontSizePt: 11,
      },
      box: {
        widthInches: 2,
        wrap: 'word',
      },
      sourceKind: 'generated',
    });

    expect(measured.lineCount).toBeGreaterThan(0);
    expect(measured.usedFallback).toBe(true);
  });
});
