import type { BrowserWindow, WebContents } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { SampledVisualSchema, recordCanvasVisualFrame, visualFrameColor, visualFrameDarkness } from './visualFrameElectron';
import { DocumentMapMetadataEvidenceSchema } from './mapLabelPlacementDefinitions';
import { visualCssPixelRegion } from './visualSampling';
import { compareCanvasTitleInk } from './visualOracle/compareCanvasTitleInk';

/** 硬件和软件都执行身份牌/补片/标题与冷开原门；只按各自实际分辨率取证。 */
export async function verifySceneStaticVisual(win: BrowserWindow, output: string, evaluate: (contents: WebContents, expression: string) => Promise<unknown>, software = false) {
  const identity = z.array(SampledVisualSchema.extend({ dark: z.boolean(), color: z.string(), title: z.number(), image: z.string() })).length(6)
    .parse(await evaluate(win.webContents, 'window.prepareCanvasIdentityInkProbe()'));
  const identityInk = [];
  for (const sample of identity) {
    const frame = await recordCanvasVisualFrame({ ...sample, data: sample.image }, output, `scene-identity-${sample.dark}-${sample.color}`, software);
    let matching = 0;
    for (let i = 0; i < frame.pixels.length; i += 4) if (Math.abs(frame.pixels[i] - (sample.title & 255)) <= 3
      && Math.abs(frame.pixels[i + 1] - (sample.title >> 8 & 255)) <= 3 && Math.abs(frame.pixels[i + 2] - (sample.title >> 16 & 255)) <= 3) matching++;
    if (matching < 40) throw new Error(`identity_gpu_ink_not_visible:${sample.dark}:${sample.color}:${matching}`);
    identityInk.push({ dark: sample.dark, color: sample.color, matching });
  }
  const bounds = SampledVisualSchema.extend({ image: z.string() }).parse(await evaluate(win.webContents, 'window.prepareCanvasIdentityBoundsProbe()'));
  const boundsFrame = await recordCanvasVisualFrame({ ...bounds, data: bounds.image }, output, 'identity-tiny-card', software); let outsideInk = 0;
  for (let y = 0; y < boundsFrame.height; y++) for (let x = 0; x < boundsFrame.width; x++) {
    if (x / bounds.dpr >= 18 && x / bounds.dpr <= 102 && y / bounds.dpr >= 28 && y / bounds.dpr <= 64) continue;
    const i = (y * boundsFrame.width + x) * 4;
    if (Math.max(boundsFrame.pixels[i], boundsFrame.pixels[i + 1], boundsFrame.pixels[i + 2]) < 120) outsideInk++;
  }
  if (outsideInk) throw new Error(`identity_text_escaped_its_card:${outsideInk}`);
  const append = SampledVisualSchema.extend({ before: z.string(), after: z.string(), appended: z.object({ bitmapBytes: z.number(), fadingCards: z.number(), rasterTiles: z.number() }), leftClosed: z.number(), rightClosed: z.number() })
    .parse(await evaluate(win.webContents, 'window.prepareCanvasBitmapAppendProbe()'));
  const appendBefore = await recordCanvasVisualFrame({ ...append, data: append.before }, output, 'scene-append-before', software);
  const appendAfter = await recordCanvasVisualFrame({ ...append, data: append.after }, output, 'scene-append-after', software);
  const oldPixel = visualFrameColor(appendBefore, { x: 60, y: 80 }), keptPixel = visualFrameColor(appendAfter, { x: 60, y: 80 }), addedPixel = visualFrameColor(appendAfter, { x: 160, y: 80 });
  if (JSON.stringify(oldPixel) !== JSON.stringify(keptPixel) || addedPixel.g < 170 || append.leftClosed !== 1 || append.rightClosed !== 1) throw new Error('append_changed_old_pixels_or_lost_new_region');
  const metadata = SampledVisualSchema.extend({ before: z.string(), renamed: z.string(), thumbnail: z.string(), identity: z.string(), collision: DocumentMapMetadataEvidenceSchema })
    .parse(await evaluate(win.webContents, 'window.prepareCanvasDocumentMetadataProbe()'));
  const metaFrames = [];
  for (const name of ['before', 'renamed', 'thumbnail', 'identity'] as const) metaFrames.push(await recordCanvasVisualFrame({ ...metadata, data: metadata[name] }, output, `document-metadata-${name}`, software));
  const oldInk = visualFrameDarkness(metaFrames[0]), newInk = visualFrameDarkness(metaFrames[1]);
  const thumbnailPixel = visualFrameColor(metaFrames[2], { x: 32, y: 32 }), identityPixel = visualFrameColor(metaFrames[3], { x: 32, y: 32 });
  if (newInk <= oldInk * 2 || thumbnailPixel.g < 170 || thumbnailPixel.r > 160 || identityPixel.g - identityPixel.r > 20) throw new Error(`document_metadata_or_thumbnail_pixels_stale:${JSON.stringify({ oldInk, newInk, thumbnailPixel, identityPixel })}`);
  const collision = metadata.collision;
  const collisionBefore = await recordCanvasVisualFrame({ ...collision, data: collision.before }, output, 'document-hidden-title-before', software);
  const collisionAfter = await recordCanvasVisualFrame({ ...collision, data: collision.after }, output, 'document-hidden-title-after', software);
  const revealed = visualCssPixelRegion(collisionBefore, collision.revealedRegion, collision.dpr);
  const unchanged = visualCssPixelRegion(collisionBefore, collision.unchangedRegion, collision.dpr);
  const hiddenPixels = collisionBefore.image.crop(revealed).toBitmap(), revealedPixels = collisionAfter.image.crop(revealed).toBitmap();
  const firstBefore = collisionBefore.image.crop(unchanged).toBitmap(), firstAfter = collisionAfter.image.crop(unchanged).toBitmap();
  const hiddenInk = compareCanvasTitleInk(hiddenPixels, hiddenPixels, 'ink').union;
  const revealedInk = compareCanvasTitleInk(revealedPixels, revealedPixels, 'ink').union;
  const priorInk = compareCanvasTitleInk(firstBefore, firstBefore, 'ink').union;
  const priorUnchanged = firstBefore.equals(firstAfter);
  await writeFile(path.join(output, 'document-hidden-title-facts.json'), JSON.stringify({ hiddenInk, revealedInk, priorInk, priorUnchanged,
    revealed, unchanged, renders: collision.renders, sampling: collision.sampling }, null, 2));
  if (hiddenInk || !revealedInk || !priorInk || !priorUnchanged || collision.renders.after <= collision.renders.before || collision.renders.duplicate !== collision.renders.after)
    throw new Error(`hidden_document_metadata_title_not_revealed:${JSON.stringify({ hiddenInk, revealedInk, priorInk, priorUnchanged, renders: collision.renders })}`);
  const cold = SampledVisualSchema.extend({ before: z.string(), after: z.string(), initial: z.object({ renderableCards: z.literal(2), rasterCards: z.literal(2) }), current: z.object({ renderableCards: z.literal(2), rasterCards: z.literal(2) }) })
    .parse(await evaluate(win.webContents, 'window.prepareCanvasColdProjectionProbe()'));
  const coldBefore = await recordCanvasVisualFrame({ ...cold, data: cold.before }, output, 'cold-projection-initial', software);
  const coldAfter = await recordCanvasVisualFrame({ ...cold, data: cold.after }, output, 'cold-projection-moved', software);
  const initialCardPixel = visualFrameColor(coldBefore, { x: 350, y: 100 }), movedCardPixel = visualFrameColor(coldAfter, { x: 140, y: 100 });
  if (initialCardPixel.g < 170 || initialCardPixel.r > 100 || movedCardPixel.g < 170 || movedCardPixel.r > 100) throw new Error('cold_or_directly_moved_bitmap_not_actually_drawn');
  return { identityInk, outsideInk, append: { ...append.appended, oldPixel, keptPixel, addedPixel, leftClosed: append.leftClosed, rightClosed: append.rightClosed },
    metadata: { oldInk, newInk, thumbnailPixel, identityPixel, collision: { hiddenInk, revealedInk, priorInk, priorUnchanged, revealed, unchanged, renders: collision.renders } },
    cold: { initial: cold.initial, current: cold.current, initialCardPixel, movedCardPixel } };
}
