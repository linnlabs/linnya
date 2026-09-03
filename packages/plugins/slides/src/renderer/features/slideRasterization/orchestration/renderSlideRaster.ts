import {
  resolveSlideRasterPixelSize,
  type SlideRasterRequest,
  type SlideRasterSuccess,
} from '@plugin/slides/shared/slideRasterization';
import {
  RenderImageResourceError,
} from '../../renderImageResources';
import { RenderChartResourceError } from '../../renderChartResources';
import { loadSlideVisualResources } from '../../renderVisualResources';
import { SlideRasterizationError } from '../definitions/slideRasterizationError';
import { createKonvaRasterCanvas } from '../functions/createKonvaRasterCanvas';

export async function renderSlideRasterToCanvas(
  request: SlideRasterRequest,
  signal?: AbortSignal,
): Promise<HTMLCanvasElement> {
  const pixelSize = resolveSlideRasterPixelSize(request.profile);

  try {
    signal?.throwIfAborted();
    const resources = await loadSlideVisualResources(request.slide, {
      failureMode: 'reject',
      chartPixelRatio: request.profile.pixelRatio,
      ...(signal ? { signal } : {}),
    });
    signal?.throwIfAborted();

    return createKonvaRasterCanvas({
      slide: request.slide,
      slideSize: request.slideSize,
      pixelSize,
      images: resources.imageResources,
      chartResources: resources.chartResources,
      transparentBackground: request.profile.transparentBackground,
    });
  } catch (error) {
    if (error instanceof SlideRasterizationError) {
      throw error;
    }
    if (error instanceof RenderImageResourceError || error instanceof RenderChartResourceError) {
      throw new SlideRasterizationError(
        'slides.raster.resource_load_failed',
        error.message,
      );
    }
    throw new SlideRasterizationError(
      'slides.raster.render_failed',
      error instanceof Error ? error.message : 'Slide raster rendering failed',
    );
  }
}

export async function renderSlideRasterToImageBitmap(
  request: SlideRasterRequest,
  signal?: AbortSignal,
): Promise<ImageBitmap> {
  const canvas = await renderSlideRasterToCanvas(request, signal);
  try {
    signal?.throwIfAborted();
    return await createImageBitmap(canvas);
  } catch (error) {
    throw new SlideRasterizationError(
      'slides.raster.render_failed',
      error instanceof Error ? error.message : 'ImageBitmap creation failed',
    );
  }
}

export async function renderSlideRasterToPng(
  request: SlideRasterRequest,
  signal?: AbortSignal,
): Promise<SlideRasterSuccess> {
  const canvas = await renderSlideRasterToCanvas(request, signal);
  signal?.throwIfAborted();
  const bytes = await encodeCanvasAsPng(canvas);
  signal?.throwIfAborted();
  const pixelSize = resolveSlideRasterPixelSize(request.profile);
  return {
    status: 'success',
    requestId: request.requestId,
    format: request.profile.format,
    widthPx: pixelSize.widthPx,
    heightPx: pixelSize.heightPx,
    bytes,
  };
}

async function encodeCanvasAsPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
  if (!blob) {
    throw new SlideRasterizationError(
      'slides.raster.encode_failed',
      'Canvas PNG encoding returned no data',
    );
  }
  return new Uint8Array(await blob.arrayBuffer());
}
