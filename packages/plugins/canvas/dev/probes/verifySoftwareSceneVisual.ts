import type { BrowserWindow, WebContents } from 'electron';
import { z } from 'zod';
import { assertSoftwareVisualSampling } from './visualSampling';
import { SampledVisualSchema, recordCanvasVisualFrame, visualFrameColor, visualFrameDarkness } from './visualFrameElectron';

/** 软件模式测试即时终态的真实像素/释放/输入，而不是把硬件中间态断言静默跳过。 */
export async function verifySoftwareSceneVisual(win: BrowserWindow, output: string, evaluate: (contents: WebContents, expression: string) => Promise<unknown>) {
  const receipt = z.object({ firstPresented: z.boolean(), rendered: z.boolean(), acceptedAfterRender: z.number() });
  const source = SampledVisualSchema.extend({ before: z.string(), firstImage: z.string(), moved: z.string(), opaque: z.string(), covered: z.string(), revealed: z.string(),
    mapBefore: z.string(), mapAfter: z.string(), uploaded: receipt, first: receipt, ownerCloses: z.array(z.number()),
    stats: z.object({ cards: z.number(), bitmaps: z.number(), fadingCards: z.number(), sceneTransitions: z.number(), retiringBytes: z.number() }), dragTarget: z.number(), finalTarget: z.number() })
    .parse(await evaluate(win.webContents, 'window.prepareCanvasSoftwareSceneProbe()'));
  assertSoftwareVisualSampling(source.sampling);
  const frames = [];
  for (const name of ['before', 'firstImage', 'moved', 'opaque', 'covered', 'revealed', 'mapBefore', 'mapAfter'] as const)
    frames.push(await recordCanvasVisualFrame({ ...source, data: source[name] }, output, `software-scene-${name}`, true));
  const before = visualFrameColor(frames[0], { x: 60, y: 80 }), first = visualFrameColor(frames[1], { x: 60, y: 80 });
  const moved = visualFrameColor(frames[2], { x: 390, y: 80 }), opaque = visualFrameColor(frames[3], { x: 390, y: 80 });
  const covered = visualFrameColor(frames[4], { x: 390, y: 80 }), revealed = visualFrameColor(frames[5], { x: 390, y: 80 });
  const mapInk = { before: visualFrameDarkness(frames[6]), after: visualFrameDarkness(frames[7]) };
  if (JSON.stringify(before) !== JSON.stringify({ r: 224, g: 32, b: 32 }) || JSON.stringify(first) !== JSON.stringify({ r: 32, g: 192, b: 96 })
    || JSON.stringify(moved) !== JSON.stringify(first) || Math.min(opaque.r, opaque.g, opaque.b) < 230
    || JSON.stringify(covered) !== JSON.stringify({ r: 32, g: 48, b: 224 }) || JSON.stringify(revealed) !== JSON.stringify(first)) throw new Error('software_scene_immediate_pixels_missing');
  if (source.uploaded.firstPresented || source.uploaded.rendered || !source.first.firstPresented || !source.first.rendered
    || source.ownerCloses.length !== 3 || source.ownerCloses.some(count => count !== 1) || source.stats.cards || source.stats.bitmaps
    || source.stats.fadingCards || source.stats.sceneTransitions || source.stats.retiringBytes || mapInk.before < 100 || mapInk.after
    || source.dragTarget !== 345 || source.finalTarget !== 330) throw new Error('software_scene_receipts_ownership_or_input_failed');
  return { profile: 'software-immediate', sampling: source.sampling, uploaded: source.uploaded, first: source.first, ownerCloses: source.ownerCloses,
    stats: source.stats, dragTarget: source.dragTarget, finalTarget: source.finalTarget, before, firstPixel: first, moved, opaque, covered, revealed, mapInk };
}
