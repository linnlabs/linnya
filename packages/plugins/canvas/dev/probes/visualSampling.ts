import { z } from 'zod';
import type { CanvasKernel } from '../../src/renderer/kernel';

export const CanvasVisualSamplingSchema = z.object({
  mode: z.enum(['interactive', 'capture']), windowDpr: z.number().positive(), resolution: z.number().positive(),
  css: z.object({ width: z.number().positive(), height: z.number().positive() }),
  canvas: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  status: z.object({ limited: z.boolean(), phase: z.enum(['ready', 'restoring']), message: z.string().nullable() }),
});
type VisualSampling = z.infer<typeof CanvasVisualSamplingSchema>;
interface ImageSize { readonly width: number; readonly height: number; readonly pixels?: Uint8Array | Uint8ClampedArray }

/** mode来自创建入口的明确参数；window DPR不能冒充软件交互实际resolution。 */
export function readCanvasVisualSampling(kernel: Pick<CanvasKernel, 'canvas' | 'readResolution' | 'readRenderStatus'>, mode: 'interactive' | 'capture') {
  const bounds = kernel.canvas.getBoundingClientRect();
  return CanvasVisualSamplingSchema.parse({ mode, windowDpr: devicePixelRatio, resolution: kernel.readResolution(),
    css: { width: bounds.width, height: bounds.height }, canvas: { width: kernel.canvas.width, height: kernel.canvas.height }, status: kernel.readRenderStatus() });
}
function assertImageSize(image: ImageSize): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0) throw new Error('visual_image_dimensions_invalid');
  if (image.pixels && image.pixels.byteLength !== image.width * image.height * 4) throw new Error('visual_image_bytes_mismatch');
}
/** 先核实际PNG/底图尺寸，不能用窗口2x去索引软件1x图后把undefined当背景。 */
export function assertVisualImageSampling(image: ImageSize, sampling: VisualSampling): void {
  assertImageSize(image);
  const expectedWidth = Math.round(sampling.css.width * sampling.resolution), expectedHeight = Math.round(sampling.css.height * sampling.resolution);
  if (sampling.canvas.width !== expectedWidth || sampling.canvas.height !== expectedHeight) throw new Error('visual_canvas_sampling_mismatch');
  if (image.width !== expectedWidth || image.height !== expectedHeight) throw new Error('visual_image_sampling_mismatch');
}
export function visualPixelOffset(frame: Required<ImageSize>, point: { readonly x: number; readonly y: number }): number {
  assertImageSize(frame);
  if (!Number.isInteger(point.x) || !Number.isInteger(point.y) || point.x < 0 || point.y < 0 || point.x >= frame.width || point.y >= frame.height) throw new Error('visual_pixel_out_of_bounds');
  return (point.y * frame.width + point.x) * 4;
}
export function assertSoftwareVisualSampling(sampling: VisualSampling): void {
  if (sampling.mode !== 'interactive' || sampling.resolution !== 1 || !sampling.status.limited) throw new Error('visual_software_interactive_sampling_mismatch');
}
