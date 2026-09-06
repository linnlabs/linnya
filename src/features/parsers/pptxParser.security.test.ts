import { describe, expect, it } from 'vitest';
import path from 'path';

import { resolvePptxEntryPath } from './pptxParser';

describe('PPTX ZIP entry path containment', () => {
  it('keeps normal entries inside the extraction directory', () => {
    const extractionDir = path.join(process.cwd(), 'tmp', 'pptx-parse');
    expect(resolvePptxEntryPath(extractionDir, 'ppt/slides/slide1.xml')).toBe(
      path.join(extractionDir, 'ppt', 'slides', 'slide1.xml')
    );
  });

  it('rejects parent traversal entries', () => {
    const extractionDir = path.join(process.cwd(), 'tmp', 'pptx-parse');
    expect(() => resolvePptxEntryPath(extractionDir, '../outside.txt')).toThrow(
      'escapes extraction directory'
    );
  });
});
