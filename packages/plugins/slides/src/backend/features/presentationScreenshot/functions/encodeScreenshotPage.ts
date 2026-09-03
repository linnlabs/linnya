import { transcodeImageToJpeg } from '@plugin/backend/imageTranscoding';
import { SLIDES_RASTER_MAX_OUTPUT_PIXELS } from '@plugin/slides/shared/slideRasterization';
import type { PresentationScreenshotEncoding } from '../definitions/presentationScreenshot';

export async function encodeScreenshotPage(
  pngBytes: Uint8Array,
  encoding: PresentationScreenshotEncoding,
): Promise<Uint8Array> {
  if (encoding.kind === 'lossless_png') return pngBytes;

  return transcodeImageToJpeg(pngBytes, {
    quality: 90,
    chromaSubsampling: '4:4:4',
    maxInputPixels: SLIDES_RASTER_MAX_OUTPUT_PIXELS,
  });
}
