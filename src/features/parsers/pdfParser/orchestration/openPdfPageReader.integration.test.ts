import { describe, expect, it } from 'vitest';

import { createTextPdf } from '../testkit/createTextPdf';
import { openPdfPageReader } from './openPdfPageReader';

describe('openPdfPageReader 按页读取', () => {
  it('保留行、识别没有文字层的页，并能渲染单页', async () => {
    const reader = await openPdfPageReader(createTextPdf([
      ['Annual report 2026', 'Revenue grew (by 12%) in Asia.'],
      null,
      ['Appendix A'],
    ]));
    try {
      expect(reader.pageCount).toBe(3);
      await expect(reader.readPageText(1)).resolves.toEqual({
        pageNumber: 1,
        text: 'Annual report 2026\nRevenue grew (by 12%) in Asia.',
        layout: 'direct',
      });
      await expect(reader.readPageText(2)).resolves.toEqual({ pageNumber: 2, text: '', layout: 'no_text' });
      await expect(reader.readPageText(4)).rejects.toThrow(RangeError);

      const image = await reader.renderPageToJpeg(2);
      expect(image.jpegBytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      expect(Math.max(image.width, image.height)).toBe(1536);
    } finally {
      await reader.close();
    }
  });

  it('多栏页逐栏输出，左栏读完再读右栏', async () => {
    const left = Array.from({ length: 24 }, (_, index) => `${index % 6 === 5 ? '  ' : ''}Left column line ${index + 1}`);
    const right = Array.from({ length: 24 }, (_, index) => `${index % 6 === 5 ? '  ' : ''}Right column line ${index + 1}`);
    const reader = await openPdfPageReader(createTextPdf([{ columns: [left, right] }]));
    try {
      const page = await reader.readPageText(1);
      expect(page.layout).toBe('columns');
      const text = page.text;
      expect(text.indexOf('Left column line 24')).toBeLessThan(text.indexOf('Right column line 1'));
      expect(text).toContain('Left column line 1\nLeft column line 2');
    } finally {
      await reader.close();
    }
  });
});
