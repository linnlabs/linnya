import type {
  PresentationRenderModel,
  PresentationSourceKind,
} from '@plugin/slides/shared';

export type PresentationScreenshotSelection =
  | { readonly kind: 'all' }
  | { readonly kind: 'single'; readonly slideNumber: number }
  | {
      readonly kind: 'range';
      readonly fromSlideNumber: number;
      readonly toSlideNumber: number;
    };

export interface PresentationScreenshotProfileInput {
  readonly id: string;
  readonly viewportWidthPx: number;
  readonly pixelRatio: number;
}

export type PresentationScreenshotEncoding =
  | { readonly kind: 'lossless_png' }
  | { readonly kind: 'agent_review_jpeg' };

export type PresentationScreenshotOutputTarget =
  | {
      readonly kind: 'directory';
      readonly root: string;
      readonly overwrite: boolean;
    }
  | {
      readonly kind: 'latest_version';
      /** 当前 presentation 的稳定工作集根目录。 */
      readonly root: string;
    };

export interface PresentationScreenshotRequest {
  readonly presentationId: string;
  readonly selection: PresentationScreenshotSelection;
  readonly profile: PresentationScreenshotProfileInput;
  readonly encoding: PresentationScreenshotEncoding;
  readonly output: PresentationScreenshotOutputTarget;
}

export interface PresentationScreenshotSourceIdentity {
  readonly presentationId: string;
  readonly title: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly sourceKind: PresentationSourceKind;
}

export interface PresentationScreenshotSource {
  readonly identity: PresentationScreenshotSourceIdentity;
  readonly renderModel: PresentationRenderModel;
  /** imported/patched deck 的 embedded part 来源；generated data URI 不需要它。 */
  readonly sourcePackageBytes?: Uint8Array;
}

export interface PresentationScreenshotSlide {
  readonly slideNumber: number;
  readonly relativePath: string;
}

export interface PresentationScreenshotResult {
  readonly presentation: PresentationScreenshotSourceIdentity;
  readonly requestedSlideNumbers: readonly number[];
  readonly slides: readonly PresentationScreenshotSlide[];
}

export type SlidesScreenshotErrorCode =
  | 'slides.screenshot.invalid_request'
  | 'slides.screenshot.pixel_budget_exceeded'
  | 'slides.screenshot.slide_out_of_range'
  | 'slides.screenshot.output_conflict'
  | 'slides.screenshot.resource_load_failed'
  | 'slides.screenshot.render_failed'
  | 'slides.screenshot.invalid_png'
  | 'slides.screenshot.stale_version'
  | 'slides.screenshot.output_write_failed';

export class SlidesScreenshotError extends Error {
  readonly name = 'SlidesScreenshotError';

  constructor(
    readonly code: SlidesScreenshotErrorCode,
    message: string,
    readonly slideNumber?: number,
  ) {
    super(message);
  }
}
