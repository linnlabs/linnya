import { describe, expect, it } from 'vitest';
import { buildRasterPdfDocumentHtml } from './buildRasterPdfDocumentHtml';

describe('buildRasterPdfDocumentHtml', () => {
  it('按输入顺序建立固定物理尺寸页面且不追加空白页', () => {
    const html = buildRasterPdfDocumentHtml({
      pageWidthInches: 13.333,
      pageHeightInches: 7.5,
      pages: [
        { fileName: 'page-0001.png' },
        { fileName: 'page-0002.png' },
      ],
    });

    expect(html.indexOf('page-0001.png')).toBeLessThan(html.indexOf('page-0002.png'));
    expect(html).toContain('@page { size: 13.333in 7.5in; margin: 0; }');
    expect(html).toContain('.pdf-page:last-child { break-after: auto; }');
    expect(html.match(/class="pdf-page"/gu)).toHaveLength(2);
  });
});
