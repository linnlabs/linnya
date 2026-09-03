import { describe, expect, it } from 'vitest';
import {
  buildEditorBlockBackgroundColorOptions,
  buildEditorBlockTextColorOptions,
} from './editorBlockColorPalette';

const CJK_TEXT_PATTERN = /[\u4e00-\u9fff]/;

describe('editorBlockColorPalette', () => {
  it('keeps color fallback labels language-neutral', () => {
    const colorOptions = [
      ...buildEditorBlockTextColorOptions(),
      ...buildEditorBlockBackgroundColorOptions(),
    ];

    for (const option of colorOptions) {
      expect(option.labelKey).toMatch(/^shared\.color\./);
      expect(option.label).not.toMatch(CJK_TEXT_PATTERN);
    }
  });

  it('uses the provided resolver for visible labels', () => {
    const colorOptions = buildEditorBlockTextColorOptions((key) => `resolved:${key}`);

    expect(colorOptions[0]?.label).toBe('resolved:shared.color.red');
  });
});
