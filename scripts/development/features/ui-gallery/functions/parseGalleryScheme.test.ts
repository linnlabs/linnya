import { describe, expect, it } from 'vitest';
import {
  parseGalleryScheme,
  readGallerySchemeId,
  readGallerySchemeLabel,
} from './parseGalleryScheme.ts';

describe('parseGalleryScheme', () => {
  it('uses the first line of the leading comment as the label', () => {
    const css = '/*\n * 暖纸中性色\n * 灰阶加一点暖色\n */\n:root { --x: 1; }';
    expect(parseGalleryScheme('warm-paper.css', css)).toEqual({
      id: 'warm-paper',
      label: '暖纸中性色',
      css,
    });
  });

  it('falls back to the file id when the file has no leading comment', () => {
    expect(readGallerySchemeLabel(':root { --x: 1; }')).toBeNull();
    expect(parseGalleryScheme('a.css', ':root {}').label).toBe('a');
  });

  it('rejects names that cannot be URL parameters or that shadow the current scheme', () => {
    expect(() => readGallerySchemeId('Warm Paper.css')).toThrow();
    expect(() => readGallerySchemeId('notes.txt')).toThrow();
    expect(() => readGallerySchemeId('current.css')).toThrow();
  });
});
