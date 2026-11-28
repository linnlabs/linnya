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
  const bytes = encodeCanvasAsPng(canvas);
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

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

/**
 * 用同步的 toDataURL 编码，不能改回 toBlob 或 OffscreenCanvas.convertToBlob。
 * Chromium 把异步 PNG 编码排进页面空闲任务：1 秒内没等到空闲才改为立即编码，开始后 5.7 秒没编完再强制完成。
 * hidden worker 窗口多数时候等不到空闲，每页白等约 1 秒、偶发约 6.7 秒，启动自检也一样。
 * toDataURL 在当前任务里直接编码，1280×720 只要几毫秒，像素与 toBlob 相同；多一次 base64 往返，对几百 KB 的 PNG 可以忽略。
 */
function encodeCanvasAsPng(canvas: HTMLCanvasElement): Uint8Array {
  const dataUrl = canvas.toDataURL('image/png');
  // 画布宽或高为 0 时浏览器返回 "data:,"，与 toBlob 回调 null 是同一种失败
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new SlideRasterizationError(
      'slides.raster.encode_failed',
      'Canvas PNG encoding returned no data',
    );
  }
  const binary = atob(dataUrl.slice(PNG_DATA_URL_PREFIX.length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
