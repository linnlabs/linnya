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
    const began = z.object({ started: z.number(), reduced: z.boolean() }).parse(await evaluate(win.webContents, 'window.beginCanvasReducedSceneProbe()'));
    if (began.started !== 1 || began.reduced) throw new Error('scene_motion_was_not_running_before_system_preference_change');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reduced: unknown = await evaluate(win.webContents, 'window.finishCanvasReducedSceneProbe()');
    return { move: { start: move.start, middlePosition: move.middlePosition, frozen: move.frozen, camera: move.camera, stats: move.stats }, opacity: { initial, middle, opaque, removed, revealed }, mapInk, reduced };
  } finally { await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }); win.webContents.debugger.detach(); }
}
