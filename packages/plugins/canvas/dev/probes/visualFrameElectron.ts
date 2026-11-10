import { nativeImage } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CanvasVisualSamplingSchema, assertVisualImageSampling, visualCssPixelOffset, assertSoftwareVisualSampling } from './visualSampling';

export const SampledVisualSchema = z.object({ dpr: z.number().positive(), sampling: CanvasVisualSamplingSchema });
type Sampling = z.infer<typeof CanvasVisualSamplingSchema>;

/** 失败前也保存实际PNG/采样事实；严格核对后才允许任何坐标访问。 */
export async function recordCanvasVisualFrame(input: { readonly data: string; readonly dpr: number; readonly sampling: Sampling }, output: string, stem: string, software = false) {
  const image = nativeImage.createFromDataURL(input.data), size = image.getSize(), pixels = image.toBitmap();
  await writeFile(path.join(output, `${stem}-sampling.json`), JSON.stringify({ declaredDpr: input.dpr, ...input.sampling, imageSize: size, bytes: pixels.byteLength }, null, 2));
  await writeFile(path.join(output, `${stem}.png`), image.toPNG());
  if (input.dpr !== input.sampling.resolution) throw new Error('visual_declared_resolution_mismatch');
  assertVisualImageSampling({ ...size, pixels }, input.sampling);
  if (software && input.sampling.mode === 'interactive') assertSoftwareVisualSampling(input.sampling);
  return { image, pixels, ...size, sampling: input.sampling };
}
export type CanvasVisualFrame = Awaited<ReturnType<typeof recordCanvasVisualFrame>>;

export function visualFrameRgb(frame: CanvasVisualFrame, point: { readonly x: number; readonly y: number }): readonly [number, number, number] {
  const offset = visualCssPixelOffset(frame, point, frame.sampling.resolution);
  return [frame.pixels[offset + 2], frame.pixels[offset + 1], frame.pixels[offset]];
}
export function visualFrameColor(frame: CanvasVisualFrame, point: { readonly x: number; readonly y: number }) {
  const [r, g, b] = visualFrameRgb(frame, point); return { r, g, b };
}
export function visualFrameDarkness(frame: CanvasVisualFrame): number {
  let sum = 0;
  for (let i = 0; i < frame.pixels.length; i += 4) sum += Math.max(0, 180 - Math.max(frame.pixels[i], frame.pixels[i + 1], frame.pixels[i + 2]));
  return sum;
}
