import { describe, expect, it } from 'vitest';

import { PDF_RASTER_DEFAULT_TARGET_PIXELS } from '../definitions/pdfRaster';
import { openPdfRasterDocumentFromBytes } from './PdfRasterAdapter';

describe('PdfRasterAdapter integration', () => {
  it('复用同一 PDF.js 文档渲染多页 JPEG，并在关闭后释放会话', async () => {
    const pdf = createSyntheticPdf(24);
    const document = await openPdfRasterDocumentFromBytes(pdf);

    expect(document.pageCount).toBe(24);
    for (const pageNumber of [1, 12, 24]) {
      const page = await document.renderPageToJpeg(pageNumber);
      expect(page.pageNumber).toBe(pageNumber);
      expect(Math.max(page.width, page.height)).toBe(PDF_RASTER_DEFAULT_TARGET_PIXELS);
      expect(page.jpegBytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      expect(page.jpegBytes.byteLength).toBeGreaterThan(1_000);
    }

    await document.close();
    await expect(document.renderPageToJpeg(1)).rejects.toThrow('已经关闭');
  });

  it('同一文档的并发调用按顺序完成，避免同时保留多个 RGBA Canvas', async () => {
    const document = await openPdfRasterDocumentFromBytes(createSyntheticPdf(8));
    try {
      const completionOrder: number[] = [];
      await Promise.all(
        [8, 1, 5, 2].map(pageNumber =>
          document.renderPageToJpeg(pageNumber).then(page => {
            completionOrder.push(page.pageNumber);
          })
        )
      );
      expect(completionOrder).toEqual([8, 1, 5, 2]);
    } finally {
      await document.close();
    }
  });
});

function createSyntheticPdf(pageCount: number): Uint8Array {
  const fontObjectId = 3;
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from(
      { length: pageCount },
      (_, index) => `${4 + index * 2} 0 R`
    ).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const contentObjectId = 5 + pageIndex * 2;
    const content = [
      'q',
      '0.95 0.95 0.95 rg 36 720 523 80 re f',
      '0 0 0 rg BT /F1 24 Tf 54 755 Td',
      `(Linnya PDF raster benchmark page ${pageIndex + 1}) Tj ET`,
      '0.2 0.4 0.8 RG 2 w',
      ...Array.from({ length: 120 }, (_, lineIndex) => {
        const y = 690 - lineIndex * 5;
        return `48 ${y} m ${547 - (lineIndex % 7) * 10} ${y} l S`;
      }),
      'Q',
    ].join('\n');

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`
    );
  }

  let body = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body, 'binary'));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(body, 'binary');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  body += offsets
    .slice(1)
    .map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, 'binary'));
}
