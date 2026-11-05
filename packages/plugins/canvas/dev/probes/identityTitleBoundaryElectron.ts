import { nativeImage } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { MapLabelPlacementEvidenceSchema } from './mapLabelPlacementDefinitions';
import { canvasTitleInkMinimumIou, compareCanvasTitleInk } from './visualOracle/compareCanvasTitleInk';
import { assertVisualImageSampling } from './visualSampling';

function checkedCrop(image: Electron.NativeImage, region: { x: number; y: number; width: number; height: number }) {
  const size = image.getSize();
  if (![region.x, region.y, region.width, region.height].every(Number.isInteger) || region.x < 0 || region.y < 0
    || region.width <= 0 || region.height <= 0 || region.x + region.width > size.width || region.y + region.height > size.height)
    throw new Error('title_boundary_region_out_of_bounds');
  return image.crop(region).toBitmap();
}

/** 使用已有身份牌IoU门槛；所有失败也先落原PNG与实际尺寸。 */
export async function verifyCanvasTitleBoundaryPixels(contents: { executeJavaScript(code: string): Promise<unknown> }, output: string) {
  const cases = z.array(z.object({ kind: z.string(), expected: z.string(), image: z.string(), reference: z.string(), mode: z.enum(['alpha', 'ink']),
    region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }), stats: z.object({ bitmaps: z.number(), renders: z.number(), identityEntries: z.number() }).optional(),
    labelPlacement: MapLabelPlacementEvidenceSchema.optional() }))
    .parse(await contents.executeJavaScript('window.canvasTitleBoundaryPixels()'));
  const reports = [];
  for (const entry of cases) {
    const actual = nativeImage.createFromDataURL(entry.image), expected = nativeImage.createFromDataURL(entry.reference);
    await writeFile(path.join(output, `${entry.kind}-actual.png`), actual.toPNG());
    await writeFile(path.join(output, `${entry.kind}-reference.png`), expected.toPNG());
    const images = entry.labelPlacement ? { raw: nativeImage.createFromDataURL(entry.labelPlacement.rawKernelImage),
      negative: nativeImage.createFromDataURL(entry.labelPlacement.missingColumnImage) } : null;
    if (images && entry.labelPlacement) {
      await writeFile(path.join(output, `${entry.kind}-kernel-raw.png`), images.raw.toPNG());
      await writeFile(path.join(output, `${entry.kind}-missing-column-negative.png`), images.negative.toPNG());
      await writeFile(path.join(output, `${entry.kind}-sampling.json`), JSON.stringify(entry.labelPlacement.sampling, null, 2));
      for (const image of [actual, expected, images.raw, images.negative]) assertVisualImageSampling({ ...image.getSize(), pixels: image.toBitmap() }, entry.labelPlacement.sampling);
    }
    if (actual.getSize().width !== expected.getSize().width || actual.getSize().height !== expected.getSize().height) throw new Error('title_boundary_capture_size_mismatch');
    const a = checkedCrop(actual, entry.region), b = checkedCrop(expected, entry.region);
    const ink = compareCanvasTitleInk(a, b, entry.mode);
    let placement: unknown = null;
    if (entry.labelPlacement && images) {
      const facts = entry.labelPlacement;
      const negativeInk = compareCanvasTitleInk(checkedCrop(images.negative, entry.region), b, 'ink');
      const expectedRegions = facts.candidates.filter(row => facts.expectedIds.includes(row.id)).map(row => {
        const resolution = facts.sampling.resolution;
        const region = { x: Math.floor(row.bounds.x * resolution), y: Math.floor(row.bounds.y * resolution),
          width: Math.ceil((row.bounds.x + row.bounds.width) * resolution) - Math.floor(row.bounds.x * resolution),
          height: Math.ceil((row.bounds.y + row.bounds.height) * resolution) - Math.floor(row.bounds.y * resolution) };
        const pixels = checkedCrop(actual, region), count = compareCanvasTitleInk(pixels, pixels, 'ink').union;
        return { id: row.id, region, inkPixels: count };
      });
      placement = { ...facts, missingColumnImage: undefined, rawKernelImage: undefined, negativeInk, expectedRegions,
        actualEvidence: 'PNG ink in independently expected disjoint regions; no Kernel private ids' };
      await writeFile(path.join(output, `${entry.kind}-placement.json`), JSON.stringify(placement, null, 2));
      if (negativeInk.iou >= canvasTitleInkMinimumIou || !negativeInk.union || expectedRegions.some(row => !row.inkPixels)
        || facts.stats.bitmaps || facts.stats.rasterCards || facts.stats.identityActiveLabels || !facts.stats.renders
        || facts.stats.sceneTransitions || facts.stats.cameraTransition) throw new Error(`map_placement_pixels_or_missing_column_oracle_failed:${entry.kind}`);
    }
    const report = { kind: entry.kind, expected: entry.expected, region: entry.region, actualSize: actual.getSize(), referenceSize: expected.getSize(),
      ...ink, stats: entry.stats, placement };
    reports.push(report); await writeFile(path.join(output, `${entry.kind}-pixels.json`), JSON.stringify(report, null, 2));
    if (!ink.union || report.iou < canvasTitleInkMinimumIou || (entry.stats && (entry.stats.bitmaps || !entry.stats.renders || entry.stats.identityEntries !== 1))) throw new Error(`title_boundary_grapheme_pixels_changed:${entry.kind}`);
  }
  return reports;
}
