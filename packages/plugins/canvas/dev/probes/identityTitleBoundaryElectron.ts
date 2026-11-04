import { nativeImage } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/** 使用已有身份牌IoU门槛；所有失败也先落原PNG与实际尺寸。 */
export async function verifyCanvasTitleBoundaryPixels(contents: { executeJavaScript(code: string): Promise<unknown> }, output: string) {
  const cases = z.array(z.object({ kind: z.string(), expected: z.string(), image: z.string(), reference: z.string(), mode: z.enum(['alpha', 'ink']),
    region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }), stats: z.object({ bitmaps: z.number(), renders: z.number(), identityEntries: z.number() }).optional() }))
    .parse(await contents.executeJavaScript('window.canvasTitleBoundaryPixels()'));
  const reports = [];
  for (const entry of cases) {
    const actual = nativeImage.createFromDataURL(entry.image), expected = nativeImage.createFromDataURL(entry.reference);
    await writeFile(path.join(output, `${entry.kind}-actual.png`), actual.toPNG());
    await writeFile(path.join(output, `${entry.kind}-reference.png`), expected.toPNG());
    const a = actual.crop(entry.region).toBitmap(), b = expected.crop(entry.region).toBitmap();
    let intersection = 0, union = 0;
    const ink = (pixels: Buffer, at: number) => pixels[at + 3] > 16
      && (entry.mode === 'alpha' || (pixels[at] < 150 && pixels[at + 1] < 150 && pixels[at + 2] < 150));
    if (a.length !== b.length) throw new Error('title_boundary_capture_size_mismatch');
    for (let i = 0; i < a.length; i += 4) { const x = ink(a, i), y = ink(b, i); if (x && y) intersection++; if (x || y) union++; }
    const report = { kind: entry.kind, expected: entry.expected, region: entry.region, actualSize: actual.getSize(), referenceSize: expected.getSize(),
      intersection, union, iou: intersection / union, stats: entry.stats };
    reports.push(report); await writeFile(path.join(output, `${entry.kind}-pixels.json`), JSON.stringify(report, null, 2));
    if (!union || report.iou < 0.995 || (entry.stats && (entry.stats.bitmaps || !entry.stats.renders || entry.stats.identityEntries !== 1))) throw new Error(`title_boundary_grapheme_pixels_changed:${entry.kind}`);
  }
  return reports;
}
