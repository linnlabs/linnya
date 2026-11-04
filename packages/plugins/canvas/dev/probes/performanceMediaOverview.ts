import type { BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/** 媒体初开必须先证明队列收敛与真实图像像素，失败也保留原始现场。 */
export async function verifyCanvasMediaOverview(options: {
  readonly window: BrowserWindow; readonly output: string; readonly kind: 'image' | 'document'; readonly count: number;
  readonly clustered: boolean; readonly initial: unknown; readonly resourceProfile: boolean;
}) {
  const { window: win, output, kind, count, clustered, initial } = options;
  const prefix = `${kind}-${count}-${clustered ? 'cluster' : 'uniform'}`;
  const overviewState: unknown = await win.webContents.executeJavaScript('window.waitForCanvasPerformanceBody()');
  if (options.resourceProfile) {
    const profile: unknown = await win.webContents.debugger.sendCommand('Profiler.stop');
    await writeFile(path.join(output, `${prefix}-resources.cpuprofile`), JSON.stringify(profile)); win.webContents.debugger.detach();
  }
  await writeFile(path.join(output, `${prefix}-overview-settle.json`), JSON.stringify({ initial, overviewState }, null, 2));
  const settled = z.object({ settled: z.literal(true) }).passthrough().parse(overviewState);
  const scene = z.object({ scene: z.object({ viewportCards: z.literal(count) }) }).passthrough().parse(await win.webContents.executeJavaScript('window.verifyCanvasDeterministicCounts()'));
  const before: unknown = await win.webContents.executeJavaScript('window.readCanvasPerformanceMedia()');
  await new Promise<void>(resolve => setTimeout(resolve, 250));
  const after: unknown = await win.webContents.executeJavaScript('window.readCanvasPerformanceMedia()');
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('settled_media_continues_refetching');
  const image = await win.webContents.capturePage(), pixels = image.toBitmap(); let patternPixels = 0;
  for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - 184) < 5 && Math.abs(pixels[i + 1] - 120) < 5 && Math.abs(pixels[i + 2] - 20) < 5) patternPixels++;
  if (patternPixels < 1000) throw new Error('media_overview_has_no_actual_thumbnail_pixels');
  await writeFile(path.join(output, `${prefix}-overview.png`), image.toPNG());
  return { settled, scene, before, after, patternPixels };
}
