import type { RenderNode } from '@plugin/slides/shared/renderModel';
import type { SlideRasterRequest } from '@plugin/slides/shared/slideRasterization';
import { SlideRasterizationError } from '../definitions/slideRasterizationError';

/**
 * hidden worker 没有文件系统能力。进入 worker 的图片必须已由 backend
 * 物化为 data URI，避免给 sandbox preload 暴露任意路径读取接口。
 */
export function assertSelfContainedRasterRequest(request: SlideRasterRequest): void {
  const backgroundSource = request.slide.background.imageSrc;
  if (backgroundSource && !isImageDataUri(backgroundSource)) {
    throw resourceLoadError('slide background');
  }

  assertNodeImageSources(request.slide.elements);
}

function assertNodeImageSources(nodes: readonly RenderNode[]): void {
  for (const node of nodes) {
    if (node.visible === false) {
      continue;
    }
    if (node.kind === 'image') {
      if (node.assetRef.type !== 'data' || !isImageDataUri(node.assetRef.dataUri)) {
        throw resourceLoadError(`node ${node.id}`);
      }
    } else if (node.kind === 'group') {
      assertNodeImageSources(node.children);
    }
  }
}

function isImageDataUri(value: string): boolean {
  return /^data:image\/(?:jpeg|png|webp);base64,/iu.test(value);
}

function resourceLoadError(location: string): SlideRasterizationError {
  return new SlideRasterizationError(
    'slides.raster.resource_load_failed',
    `Raster worker requires a self-contained image source for ${location}`,
  );
}
