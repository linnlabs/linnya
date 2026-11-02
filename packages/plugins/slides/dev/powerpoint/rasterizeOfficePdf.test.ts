import { it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { rasterizeOfficePdf } from './rasterizeOfficePdf';
import type { Manifest } from './definitions';

/** 固定的无字体单页 PDF，用来验证 Office PDF -> PNG adapter 的真实像素链。 */
function fixedPdf(): Buffer {
  const stream = '0.2 0.4 0.8 rg 20 20 80 30 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 210 100] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(content));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(content);
  content += `xref\n0 5\n0000000000 65535 f \n${offsets
    .slice(1)
    .map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(content);
}
it('rasterizes native Office PDF pages at the requested dimensions and rejects missing pages', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'office-pdf-test-'));
  try {
    const pdf = path.join(root, 'office.pdf');
    await writeFile(pdf, fixedPdf());
    const manifest: Manifest = {
      version: 1,
      width: 210,
      height: 100,
      deckSha256: '',
      font: 'test',
      platform: 'fixture',
      pages: [{ id: 'page', regions: [] }],
    };
    await rasterizeOfficePdf(pdf, root, manifest);
    const bytes = await readFile(path.join(root, 'slide-001.png'));
    const { data, info } = await sharp(bytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([210, 100]);
    expect([...data.subarray((60 * 210 + 30) * 3, (60 * 210 + 30) * 3 + 3)]).toEqual([
      51, 102, 204,
    ]);
    await expect(rasterizeOfficePdf(pdf, root, { ...manifest, pages: [] })).rejects.toThrow(
      'page count differs'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
