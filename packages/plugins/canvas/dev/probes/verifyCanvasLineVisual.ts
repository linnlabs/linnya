import type { BrowserWindow, WebContents } from 'electron';
import { z } from 'zod';
import { SampledVisualSchema, recordCanvasVisualFrame, visualFrameRgb } from './visualFrameElectron';
import { visualPixelOffset } from './visualSampling';

/** 完整suite与固定软件诊断复用同一组原线条断言。 */
export async function verifyCanvasLineVisual(win: BrowserWindow, output: string, evaluate: (contents: WebContents, expression: string) => Promise<unknown>, software = false) {
  const line = SampledVisualSchema.extend({ image: z.string(), half: z.string() }).parse(await evaluate(win.webContents, 'window.prepareCanvasLineVisualProbe()'));
  const frame = await recordCanvasVisualFrame({ ...line, data: line.image }, output, 'lines', software);
  const half = await recordCanvasVisualFrame({ ...line, data: line.half }, output, 'lines-half', software);
  const linePixels = frame.pixels;
  let dashInk = 0, dashGap = 0;
  for (let x = Math.ceil(80 * line.dpr); x < Math.floor(250 * line.dpr); x++) {
    const i = visualPixelOffset(frame, { x, y: Math.floor(350 * line.dpr) });
    if (linePixels[i] < 230 && linePixels[i + 1] < 230 && linePixels[i + 2] < 230) dashInk++; else dashGap++;
  }
  let dashRepeated = 0, dashSamples = 0;
  for (let x = 80 * line.dpr; x < 250 * line.dpr; x++) {
    const a = visualPixelOffset(frame, { x, y: Math.floor(350 * line.dpr) }), b = visualPixelOffset(frame, { x: x + 9 * line.dpr, y: Math.floor(350 * line.dpr) });
    if ((linePixels[a] < 230) === (linePixels[b] < 230)) dashRepeated++; dashSamples++;
  }
  if (dashRepeated / dashSamples < 0.99) throw new Error(`dash_screen_period_not_nine:${dashRepeated}:${dashSamples}`);
  const looseEndpoints = [1, 0.5].map(zoom => {
    const sample = (x: number, y: number) => visualFrameRgb(zoom === 1 ? frame : half, { x, y });
    const center = sample(100 * zoom, 450 * zoom), rim = sample(100 * zoom + 3, 450 * zoom), arrow = sample(499 * zoom, 500 * zoom);
    if (Math.max(...center) - Math.min(...center) > 8 || rim[1] >= center[1] - 8 || arrow[1] >= center[1] - 8) throw new Error(`loose_endpoint_hollow_or_screen_radius_missing:${zoom}:${center}:${rim}:${arrow}`);
    return { zoom, center, rim, arrow };
  });
  if (dashInk < 30 || dashGap < 30) throw new Error(`line_dash_is_not_rendered:${dashInk}:${dashGap}`);
  return { dashInk, dashGap, dashPeriodRatio: dashRepeated / dashSamples, looseEndpoints };
}
