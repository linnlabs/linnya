import type { RenderSlideSize, SlideRenderModel } from '../../../types/render';
import type { SlideRasterRequest } from '../../../../shared/slideRasterization';

export interface SlideThumbnailSource {
  readonly contentKey: string;
  readonly slide: SlideRenderModel;
  readonly slideSize: RenderSlideSize;
}

export interface SlideThumbnailSnapshot {
  readonly cache: ReadonlyMap<string, ImageBitmap>;
  readonly generating: boolean;
  readonly readySlides: ReadonlyMap<string, SlideRenderModel>;
  readonly failedSlideIds: readonly string[];
}

export interface SlideThumbnailEntry {
  source: SlideThumbnailSource;
  bitmap: ImageBitmap | null;
  rasterWidth: number;
  failed: boolean;
}

export interface SlideThumbnailRenderJob {
  readonly entry: SlideThumbnailEntry;
  readonly controller: AbortController;
}

export interface SlideThumbnailRendererPorts {
  readonly render: (request: SlideRasterRequest, signal: AbortSignal) => Promise<ImageBitmap>;
  /** 让出当前画面更新；返回取消本次调度的函数。 */
  readonly schedule: (work: () => void) => () => void;
  readonly publish: (snapshot: SlideThumbnailSnapshot) => void;
  readonly reportFailure: (slideId: string, error: unknown) => void;
}
