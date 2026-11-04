import { nativeImage, type BrowserWindow, type WebContents } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export async function verifySceneVisual(win: BrowserWindow, output: string, evaluate: (contents: WebContents, expression: string) => Promise<unknown>) {
  win.webContents.debugger.attach('1.3');
  try {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const images = z.object({ before: z.string(), middle: z.string(), after: z.string(), dpr: z.number() });
    const move = images.passthrough().parse(await evaluate(win.webContents, 'window.prepareCanvasSceneVisualProbe()'));
    const opacity = z.object({ initial: z.string(), middle: z.string(), opaque: z.string(), removed: z.string(), revealed: z.string(), dpr: z.number() })
      .parse(await evaluate(win.webContents, 'window.prepareCanvasSceneOpacityVisualProbe()'));
    const pixel = (url: string, dpr: number, x: number, y: number) => {
      const image = nativeImage.createFromDataURL(url), bytes = image.toBitmap(), i = (Math.round(y * dpr) * image.getSize().width + Math.round(x * dpr)) * 4;
      return { r: bytes[i + 2], g: bytes[i + 1], b: bytes[i] };
    };
    const initial = pixel(opacity.initial, opacity.dpr, 100, 100), middle = pixel(opacity.middle, opacity.dpr, 100, 100), opaque = pixel(opacity.opaque, opacity.dpr, 100, 100);
    const removed = pixel(opacity.removed, opacity.dpr, 100, 100), revealed = pixel(opacity.revealed, opacity.dpr, 100, 100);
    if (initial.r < 180 || initial.b < 180 || initial.g > 80 || middle.g <= initial.g || middle.g >= opaque.g
      || opaque.g < 230 || removed.g < 150 || removed.r > 100 || revealed.r < 180 || revealed.b < 180 || revealed.g > 50) throw new Error(`scene_actual_alpha_pixels_mismatch:${JSON.stringify({ initial, middle, opaque, removed, revealed })}`);
    for (const name of ['before', 'middle', 'after'] as const) await writeFile(path.join(output, `scene-move-${name}.png`), nativeImage.createFromDataURL(move[name]).toPNG());
    for (const name of ['initial', 'middle', 'opaque', 'removed', 'revealed'] as const) await writeFile(path.join(output, `scene-opacity-${name}.png`), nativeImage.createFromDataURL(opacity[name]).toPNG());
    const map = z.object({ before: z.string(), middle: z.string(), after: z.string() }).parse(await evaluate(win.webContents, 'window.prepareCanvasSceneMapVisualProbe()'));
    const darkness = (url: string) => { const pixels = nativeImage.createFromDataURL(url).toBitmap(); let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) sum += Math.max(0, 180 - Math.max(pixels[i], pixels[i + 1], pixels[i + 2])); return sum; };
    const mapInk = { before: darkness(map.before), middle: darkness(map.middle), after: darkness(map.after) };
    if (mapInk.before < 100 || mapInk.middle <= 0 || mapInk.middle >= mapInk.before || mapInk.after) throw new Error(`scene_map_label_did_not_fade_with_retired_paper:${JSON.stringify(mapInk)}`);
    await writeFile(path.join(output, 'scene-map-midpoint.png'), nativeImage.createFromDataURL(map.middle).toPNG());
    const identity = z.array(z.object({ dark: z.boolean(), color: z.string(), title: z.number(), image: z.string() })).parse(await evaluate(win.webContents, 'window.prepareCanvasIdentityInkProbe()'));
    const identityInk = identity.map(sample => {
      const pixels = nativeImage.createFromDataURL(sample.image).toBitmap(); let matching = 0;
      for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - (sample.title & 255)) <= 3
        && Math.abs(pixels[i + 1] - (sample.title >> 8 & 255)) <= 3 && Math.abs(pixels[i + 2] - (sample.title >> 16 & 255)) <= 3) matching++;
      if (matching < 40) throw new Error(`identity_gpu_ink_not_visible:${sample.dark}:${sample.color}:${matching}`);
      return { dark: sample.dark, color: sample.color, matching };
    });
    const identityBounds = z.object({ image: z.string(), dpr: z.number() }).parse(await evaluate(win.webContents, 'window.prepareCanvasIdentityBoundsProbe()'));
    const boundsImage = nativeImage.createFromDataURL(identityBounds.image), boundsPixels = boundsImage.toBitmap(), boundsSize = boundsImage.getSize(); let outsideInk = 0;
    for (let y = 0; y < boundsSize.height; y++) for (let x = 0; x < boundsSize.width; x++) {
      if (x / identityBounds.dpr >= 18 && x / identityBounds.dpr <= 102 && y / identityBounds.dpr >= 28 && y / identityBounds.dpr <= 64) continue;
      const i = (y * boundsSize.width + x) * 4; if (Math.max(boundsPixels[i], boundsPixels[i + 1], boundsPixels[i + 2]) < 120) outsideInk++;
    }
    await writeFile(path.join(output, 'identity-tiny-card.png'), boundsImage.toPNG());
    if (outsideInk) throw new Error(`identity_text_escaped_its_card:${outsideInk}`);
    const append = z.object({ before: z.string(), after: z.string(), appended: z.object({ bitmapBytes: z.number(), fadingCards: z.number(), rasterTiles: z.number() }), leftClosed: z.number(), rightClosed: z.number() })
      .parse(await evaluate(win.webContents, 'window.prepareCanvasBitmapAppendProbe()'));
    const oldPixel = pixel(append.before, opacity.dpr, 60, 80), keptPixel = pixel(append.after, opacity.dpr, 60, 80), addedPixel = pixel(append.after, opacity.dpr, 160, 80);
    if (JSON.stringify(oldPixel) !== JSON.stringify(keptPixel) || addedPixel.g < 170 || append.leftClosed !== 1 || append.rightClosed !== 1) throw new Error('append_changed_old_pixels_or_lost_new_region');
    const began = z.object({ started: z.number(), reduced: z.boolean() }).parse(await evaluate(win.webContents, 'window.beginCanvasReducedSceneProbe()'));
    if (began.started !== 1 || began.reduced) throw new Error('scene_motion_was_not_running_before_system_preference_change');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reduced: unknown = await evaluate(win.webContents, 'window.finishCanvasReducedSceneProbe()');
    return { move: { start: move.start, middlePosition: move.middlePosition, frozen: move.frozen, camera: move.camera, stats: move.stats }, opacity: { initial, middle, opaque, removed, revealed }, mapInk, identityInk, outsideInk, append: { ...append.appended, oldPixel, keptPixel, addedPixel, leftClosed: append.leftClosed, rightClosed: append.rightClosed }, reduced };
  } finally { await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }); win.webContents.debugger.detach(); }
}
