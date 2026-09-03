import { describe, expect, it } from 'vitest';
import {
  mapTextParagraphStyleToProps,
  mapTextRunStyleToProps,
} from '../presentationVisualDefaults.js';

describe('presentationVisualDefaults', () => {
  it('emits point-based lineSpacing and charSpacing when text style uses physical units', () => {
    expect(mapTextParagraphStyleToProps({
      fontSize: 12,
      lineSpacing: { kind: 'exactPt', value: 18 },
      letterSpacing: 1.5,
    })).toMatchObject({
      fontSize: 12,
      lineSpacing: 18,
      charSpacing: 1.5,
    });
  });

  it('emits multiplier-based lineSpacingMultiple when text style uses line-height ratio', () => {
    expect(mapTextParagraphStyleToProps({
      fontSize: 12,
      lineSpacing: { kind: 'multiple', value: 1.2 },
    })).toMatchObject({
      fontSize: 12,
      lineSpacingMultiple: 1.2,
    });
  });

  it('does not copy paragraph spacing into a rich-text run', () => {
    expect(mapTextRunStyleToProps({
      fontSize: 12,
      lineSpacing: { kind: 'multiple', value: 1.4 },
      align: 'center',
    })).toEqual({ fontSize: 12 });
  });
});
