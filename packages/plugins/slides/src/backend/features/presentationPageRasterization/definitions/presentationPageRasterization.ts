import type { PresentationRenderModel } from '@plugin/slides/shared';
import type { SlideRasterProfile } from '@plugin/slides/shared/slideRasterization';

export interface PresentationPageRasterSource {
  readonly renderModel: PresentationRenderModel;
  /** imported/patched deck 的 embedded part 来源；generated data URI 不需要它。 */
  readonly sourcePackageBytes?: Uint8Array;
}

export interface PresentationPageRasterRequest {
  readonly source: PresentationPageRasterSource;
  /** 一页只允许出现一次，返回顺序与这里一致。 */
  readonly slideNumbers: readonly number[];
  readonly profile: SlideRasterProfile;
}

export interface PresentationRasterizedPage {
  readonly slideNumber: number;
  readonly slideId: string;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly sha256: string;
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface PresentationPageRasterResult {
  readonly pages: readonly PresentationRasterizedPage[];
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface PresentationPageRasterProgress {
  readonly completedPages: number;
  readonly totalPages: number;
}

export interface PresentationPageRasterizationOptions {
  readonly signal?: AbortSignal;
  readonly onPageCompleted?: (progress: PresentationPageRasterProgress) => void;
}

export type SlidesPageRasterizationErrorCode =
  | 'slides.page-raster.invalid_request'
  | 'slides.page-raster.pixel_budget_exceeded'
  | 'slides.page-raster.resource_load_failed'
  | 'slides.page-raster.render_failed'
  | 'slides.page-raster.invalid_png';

export class SlidesPageRasterizationError extends Error {
  readonly name = 'SlidesPageRasterizationError';

  constructor(
    readonly code: SlidesPageRasterizationErrorCode,
    message: string,
    readonly slideNumber?: number,
  ) {
    super(message);
  }
}
