import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { manifestSchema, slideFile } from './definitions';
import { compareRegionImages, type RegionComparison } from './compareImages';

export const exportEvidenceSchema = z
  .object({
    deckSha256: z.string(),
    method: z.enum(['powerpoint-macos-pdf', 'powerpoint-windows-slide-export']),
    version: z.string(),
    status: z.enum(['complete', 'failed']),
    error: z.string().optional(),
  })
  .strict();
interface PageReport {
  id: string;
  image: string;
  regions: { id: string; result: RegionComparison }[];
  error?: string;
}
export interface ConformanceReport {
  status: 'review' | 'difference' | 'incomplete';
  errors: string[];
  pages: PageReport[];
}

/** 三段共享文件协议；缺页、旧样稿与尺寸不符必须产生不完整报告。 */
export async function compareConformance(root: string): Promise<ConformanceReport> {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'))
  );
  const report: ConformanceReport = { status: 'review', errors: [], pages: [] };
  await mkdir(path.join(root, 'comparison'), { recursive: true });
  try {
    const evidence = exportEvidenceSchema.parse(
      JSON.parse(await readFile(path.join(root, 'office', 'export.json'), 'utf8'))
    );
    const hash = createHash('sha256')
      .update(await readFile(path.join(root, 'sample.pptx')))
      .digest('hex');
    if (
      evidence.status !== 'complete' ||
      evidence.deckSha256 !== manifest.deckSha256 ||
      hash !== manifest.deckSha256
    ) {
      throw new Error('Office export incomplete or sample hash differs');
    }
  } catch (error) {
    report.errors.push(String(error));
  }
  for (const [index, page] of manifest.pages.entries()) {
    const filename = slideFile(index);
    const current: PageReport = { id: page.id, image: filename, regions: [] };
    report.pages.push(current);
    try {
      const [preview, office] = await Promise.all(
        ['preview', 'office'].map(folder => readFile(path.join(root, folder, filename)))
      );
      for (const bytes of [preview, office]) {
        const dimensions = await sharp(bytes).metadata();
        if (dimensions.width !== manifest.width || dimensions.height !== manifest.height)
          throw new Error('Page dimensions differ from manifest');
      }
      for (const region of page.regions)
        current.regions.push({
          id: region.id,
          result: await compareRegionImages(preview, office, region),
        });
      const a = await sharp(preview)
        .flatten({ background: '#FFFFFF' })
        .removeAlpha()
        .raw()
        .toBuffer();
      const b = await sharp(office)
        .flatten({ background: '#FFFFFF' })
        .removeAlpha()
        .raw()
        .toBuffer();
      const diff = Buffer.alloc(a.length);
      for (let offset = 0; offset < a.length; offset += 3) {
        const changed =
          Math.max(
            Math.abs(a[offset] - b[offset]),
            Math.abs(a[offset + 1] - b[offset + 1]),
            Math.abs(a[offset + 2] - b[offset + 2])
          ) > 24;
        diff[offset] = 255;
        diff[offset + 1] = changed ? 40 : 255;
        diff[offset + 2] = changed ? 100 : 255;
      }
      await sharp(diff, { raw: { width: manifest.width, height: manifest.height, channels: 3 } })
        .png()
        .toFile(path.join(root, 'comparison', filename));
    } catch (error) {
      current.error = String(error);
      report.errors.push(`${page.id}: ${String(error)}`);
    }
  }
  report.status = report.errors.length
    ? 'incomplete'
    : report.pages.some(page => page.regions.some(region => region.result.differences.length))
      ? 'difference'
      : 'review';
  await writeFile(path.join(root, 'report.json'), JSON.stringify({ manifest, report }, null, 2));
  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<!doctype html><meta charset="utf-8"><title>PowerPoint 对照报告</title><style>body{font:16px system-ui;margin:24px}img{width:32%;border:1px solid #bbb}pre{white-space:pre-wrap}section{margin-bottom:36px}</style>
<h1>PowerPoint 对照：${report.status}</h1><p>顺序：Slides 预览 / PowerPoint / 像素差异。文字指标来自墨迹行列投影；断行词语、字形、裁剪与图例标签必须看图确认。review 表示等待人工确认，不代表已通过 Office 验收。</p>
<pre>${escape(report.errors.join('\n'))}</pre>${report.pages.map((page, index) => `<section><h2>${escape(page.id)}</h2><p>预览断行：${escape(manifest.pages[index].regions.map(region => region.previewLines?.join(' | ') ?? '').join('; '))}</p><img src="preview/${page.image}"><img src="office/${page.image}"><img src="comparison/${page.image}"><pre>${escape(JSON.stringify(page, null, 2))}</pre></section>`).join('')}`;
  await writeFile(path.join(root, 'report.html'), html);
  return report;
}
