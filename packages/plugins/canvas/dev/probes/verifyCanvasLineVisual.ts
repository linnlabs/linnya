import { nativeImage, type BrowserWindow, type WebContents } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/** 完整suite与固定软件诊断复用同一组原线条断言。 */
export async function verifyCanvasLineVisual(win: BrowserWindow, output: string, evaluate: (contents: WebContents, expression: string) => Promise<unknown>) {
  const line = z.object({ dpr: z.number(), image: z.string(), half: z.string(), sampling: z.object({ mode: z.literal('interactive'), windowDpr: z.number().positive(), resolution: z.number().positive(),
    css: z.object({ width: z.number().positive(), height: z.number().positive() }), canvas: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
    status: z.object({ limited: z.boolean(), phase: z.enum(['ready', 'restoring']), message: z.string().nullable() }) }) }).parse(await evaluate(win.webContents, 'window.prepareCanvasLineVisualProbe()'));
  const lineImage = nativeImage.createFromDataURL(line.image), linePixels = lineImage.toBitmap(), lineWidth = lineImage.getSize().width;
  // 先保留真实采样与原PNG；本轮仍运行原断言，不提前修正其DPR或跳过失败。
  await writeFile(path.join(output, 'line-sampling.json'), JSON.stringify({ declaredDpr: line.dpr, ...line.sampling, imageSize: lineImage.getSize(), halfSize: nativeImage.createFromDataURL(line.half).getSize() }, null, 2));
  await writeFile(path.join(output, 'lines.png'), lineImage.toPNG());
  await writeFile(path.join(output, 'lines-half.png'), nativeImage.createFromDataURL(line.half).toPNG());
  let dashInk = 0, dashGap = 0;
  for (let x = Math.ceil(80 * line.dpr); x < Math.floor(250 * line.dpr); x++) {
    const i = (Math.floor(350 * line.dpr) * lineWidth + x) * 4;
    if (linePixels[i] < 230 && linePixels[i + 1] < 230 && linePixels[i + 2] < 230) dashInk++; else dashGap++;
  }
  let dashRepeated = 0, dashSamples = 0;
  for (let x = 80 * line.dpr; x < 250 * line.dpr; x++) {
    const a = (Math.floor(350 * line.dpr) * lineWidth + x) * 4, b = a + 9 * line.dpr * 4;
    if ((linePixels[a] < 230) === (linePixels[b] < 230)) dashRepeated++; dashSamples++;
  }
  if (dashRepeated / dashSamples < 0.99) throw new Error(`dash_screen_period_not_nine:${dashRepeated}:${dashSamples}`);
  const looseEndpoints = [1, 0.5].map(zoom => {
    const image = nativeImage.createFromDataURL(zoom === 1 ? line.image : line.half), pixels = image.toBitmap(), size = image.getSize();
    const sample = (x: number, y: number) => { const i = (Math.round(y * line.dpr) * size.width + Math.round(x * line.dpr)) * 4; return [pixels[i + 2], pixels[i + 1], pixels[i]]; };
    const center = sample(100 * zoom, 450 * zoom), rim = sample(100 * zoom + 3, 450 * zoom), arrow = sample(499 * zoom, 500 * zoom);
    if (Math.max(...center) - Math.min(...center) > 8 || rim[1] >= center[1] - 8 || arrow[1] >= center[1] - 8) throw new Error(`loose_endpoint_hollow_or_screen_radius_missing:${zoom}:${center}:${rim}:${arrow}`);
    return { zoom, center, rim, arrow };
  });
  if (dashInk < 30 || dashGap < 30) throw new Error(`line_dash_is_not_rendered:${dashInk}:${dashGap}`);
  return { dashInk, dashGap, dashPeriodRatio: dashRepeated / dashSamples, looseEndpoints };
}
