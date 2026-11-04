import type { BrowserWindow, WebContents } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { SampledVisualSchema, recordCanvasVisualFrame, visualFrameColor, visualFrameDarkness } from './visualFrameElectron';

type Evaluate = (contents: WebContents, expression: string) => Promise<unknown>;
async function verifyHardwareMotion(win: BrowserWindow, output: string, evaluate: Evaluate) {
  const move = SampledVisualSchema.extend({ before: z.string(), middle: z.string(), after: z.string() }).passthrough()
    .parse(await evaluate(win.webContents, 'window.prepareCanvasSceneVisualProbe()'));
  for (const name of ['before', 'middle', 'after'] as const) await recordCanvasVisualFrame({ ...move, data: move[name] }, output, `scene-move-${name}`);
  const opacity = SampledVisualSchema.extend({ initial: z.string(), middle: z.string(), opaque: z.string(), removed: z.string(), revealed: z.string() }).passthrough()
    .parse(await evaluate(win.webContents, 'window.prepareCanvasSceneOpacityVisualProbe()'));
  const frames = [];
  for (const name of ['initial', 'middle', 'opaque', 'removed', 'revealed'] as const)
    frames.push(await recordCanvasVisualFrame({ ...opacity, data: opacity[name] }, output, `scene-opacity-${name}`));
  const [initial, middle, opaque, removed, revealed] = frames.map(frame => visualFrameColor(frame, { x: 100, y: 100 }));
  await writeFile(path.join(output, 'scene-opacity.json'), JSON.stringify({ initial, middle, opaque, removed, revealed,
    logicalTimes: opacity.logicalTimes, stats: opacity.stats, dpr: opacity.dpr, sampling: opacity.sampling }, null, 2));
  if (initial.r < 180 || initial.b < 180 || initial.g > 80 || middle.g <= initial.g || middle.g >= opaque.g
    || opaque.g < 230 || removed.g < 150 || removed.r > 100 || revealed.r < 180 || revealed.b < 180 || revealed.g > 50) throw new Error(`scene_actual_alpha_pixels_mismatch:${JSON.stringify({ initial, middle, opaque, removed, revealed })}`);
  const map = SampledVisualSchema.extend({ before: z.string(), middle: z.string(), after: z.string() })
    .parse(await evaluate(win.webContents, 'window.prepareCanvasSceneMapVisualProbe()'));
  const mapFrames = [];
  for (const name of ['before', 'middle', 'after'] as const) mapFrames.push(await recordCanvasVisualFrame({ ...map, data: map[name] }, output, `scene-map-${name}`));
  const mapInk = { before: visualFrameDarkness(mapFrames[0]), middle: visualFrameDarkness(mapFrames[1]), after: visualFrameDarkness(mapFrames[2]) };
  if (mapInk.before < 100 || mapInk.middle <= 0 || mapInk.middle >= mapInk.before || mapInk.after) throw new Error(`scene_map_label_did_not_fade_with_retired_paper:${JSON.stringify(mapInk)}`);
  return { move: { start: move.start, middlePosition: move.middlePosition, frozen: move.frozen, camera: move.camera, stats: move.stats },
    opacity: { initial, middle, opaque, removed, revealed }, mapInk };
}
async function verifyHardwareBodyReceipts(win: BrowserWindow, output: string, evaluate: Evaluate) {
  const receipt = z.object({ firstPresented: z.boolean(), rendered: z.boolean(), acceptedAfterRender: z.number() });
  const raw = await evaluate(win.webContents, 'window.prepareCanvasFirstBodyProbe()');
  const failed = SampledVisualSchema.extend({ failure: z.literal('new_visible_bitmap_draw_missing_first_receipt'), fadeImage: z.string(), facts: z.unknown() }).safeParse(raw);
  if (failed.success) {
    await recordCanvasVisualFrame({ ...failed.data, data: failed.data.fadeImage }, output, 'first-body-failure');
    await writeFile(path.join(output, 'first-body-failure.json'), JSON.stringify({ failure: failed.data.failure, dpr: failed.data.dpr, facts: failed.data.facts }, null, 2));
    throw new Error(failed.data.failure);
  }
  const body = SampledVisualSchema.extend({ uploaded: receipt, first: receipt, complete: receipt, sceneStart: receipt, sceneFirst: receipt, sceneComplete: receipt,
    fadeImage: z.string(), sceneImage: z.string(), logicalTimes: z.unknown() }).parse(raw);
  const fade = await recordCanvasVisualFrame({ ...body, data: body.fadeImage }, output, 'first-body-fade');
  const scene = await recordCanvasVisualFrame({ ...body, data: body.sceneImage }, output, 'first-body-scene');
  const fadePixel = visualFrameColor(fade, { x: 60, y: 80 }), scenePixel = visualFrameColor(scene, { x: 60, y: 80 });
  await writeFile(path.join(output, 'first-body-receipts.json'), JSON.stringify({ uploaded: body.uploaded, first: body.first, complete: body.complete,
    sceneStart: body.sceneStart, sceneFirst: body.sceneFirst, sceneComplete: body.sceneComplete, fadePixel, scenePixel, logicalTimes: body.logicalTimes }, null, 2));
  if (fadePixel.g <= 32 || scenePixel.g <= 0 || !body.first.firstPresented || body.first.rendered
    || !body.complete.rendered || !body.sceneFirst.firstPresented || body.sceneFirst.rendered || !body.sceneComplete.rendered) throw new Error('first_body_receipt_has_no_visible_current_pixels');
  return { uploaded: body.uploaded, first: body.first, complete: body.complete, sceneStart: body.sceneStart, sceneFirst: body.sceneFirst, fadePixel, scenePixel };
}
export async function verifyHardwareSceneVisual(win: BrowserWindow, output: string, evaluate: Evaluate) {
  return { ...await verifyHardwareMotion(win, output, evaluate), firstBody: await verifyHardwareBodyReceipts(win, output, evaluate) };
}
