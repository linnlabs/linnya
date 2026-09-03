import { randomUUID } from 'node:crypto';
import { inspectImageBytes } from '@plugin/backend/imageInspection';
import {
  isSlideRasterPixelSizeWithinBudget,
  resolveSlideRasterPixelSize,
  SLIDES_RASTER_MAX_OUTPUT_PIXELS,
  type SlideRasterErrorCode,
  type SlideRasterRequest,
  type SlideRasterResult,
} from '@plugin/slides/shared/slideRasterization';
import { invokeSlidesRasterWorker } from '../../slideRasterWorker/orchestration/invokeSlidesRasterWorker';
import {
  SlidesPageRasterizationError,
  type PresentationPageRasterizationOptions,
  type PresentationPageRasterRequest,
  type PresentationPageRasterResult,
  type PresentationRasterizedPage,
} from '../definitions/presentationPageRasterization';
import { materializePresentationPage } from './materializePresentationPage';

export interface PresentationPageRasterizationRuntimeDeps {
  readonly invokeRasterWorker?: (
    request: SlideRasterRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<SlideRasterResult>;
  readonly createRunId?: () => string;
}

export class PresentationPageRasterizationRuntime {
  private readonly invokeRasterWorker: NonNullable<
    PresentationPageRasterizationRuntimeDeps['invokeRasterWorker']
  >;
  private readonly createRunId: () => string;

  constructor(deps: PresentationPageRasterizationRuntimeDeps = {}) {
    this.invokeRasterWorker = deps.invokeRasterWorker ?? invokeSlidesRasterWorker;
    this.createRunId = deps.createRunId ?? randomUUID;
  }

  async render(
    request: PresentationPageRasterRequest,
    options: PresentationPageRasterizationOptions = {},
  ): Promise<PresentationPageRasterResult> {
    options.signal?.throwIfAborted();
    assertRequest(request);
    const pixelSize = resolveSlideRasterPixelSize(request.profile);
    if (!isSlideRasterPixelSizeWithinBudget(pixelSize)) {
      throw new SlidesPageRasterizationError(
        'slides.page-raster.pixel_budget_exceeded',
        'Presentation page output exceeds the pixel limit',
      );
    }

    const runId = this.createRunId();
    const pages: PresentationRasterizedPage[] = [];
    for (const slideNumber of request.slideNumbers) {
      options.signal?.throwIfAborted();
      const slide = request.source.renderModel.slides[slideNumber - 1];
      const materializedSlide = await materializePresentationPage({
        slide,
        sourcePackageBytes: request.source.sourcePackageBytes,
      });
      const result = await this.invokeRasterWorker(
        {
          requestId: `${runId}:slide:${slideNumber}`,
          slide: materializedSlide,
          slideSize: request.source.renderModel.slideSize,
          profile: request.profile,
        },
        options.signal ? { signal: options.signal } : undefined,
      );
      options.signal?.throwIfAborted();
      const verified = await verifyRasterResult(result, pixelSize, slideNumber);
      pages.push({
        slideNumber,
        slideId: slide.slideId,
        ...verified,
      });
      options.onPageCompleted?.({
        completedPages: pages.length,
        totalPages: request.slideNumbers.length,
      });
    }

    return {
      pages,
      widthPx: pixelSize.widthPx,
      heightPx: pixelSize.heightPx,
    };
  }
}

function assertRequest(request: PresentationPageRasterRequest): void {
  const slideCount = request.source.renderModel.slides.length;
  const uniqueSlideNumbers = new Set(request.slideNumbers);
  if (
    request.slideNumbers.length === 0
    || uniqueSlideNumbers.size !== request.slideNumbers.length
    || request.slideNumbers.some(slideNumber => (
      !Number.isInteger(slideNumber)
      || slideNumber < 1
      || slideNumber > slideCount
    ))
  ) {
    throw new SlidesPageRasterizationError(
      'slides.page-raster.invalid_request',
      'Presentation page selection is invalid',
    );
  }
}

async function verifyRasterResult(
  result: SlideRasterResult,
  expected: { readonly widthPx: number; readonly heightPx: number },
  slideNumber: number,
): Promise<Omit<PresentationRasterizedPage, 'slideNumber' | 'slideId'>> {
  if (result.status === 'failure') {
    throw mapRasterFailure(result.error.code, slideNumber);
  }
  if (result.widthPx !== expected.widthPx || result.heightPx !== expected.heightPx) {
    throw invalidPng(slideNumber);
  }
  try {
    const inspected = await inspectImageBytes(result.bytes, {
      maxImagePixels: SLIDES_RASTER_MAX_OUTPUT_PIXELS,
    });
    if (
      inspected.mediaType !== 'image/png'
      || inspected.width !== expected.widthPx
      || inspected.height !== expected.heightPx
      || inspected.byteLength !== result.bytes.byteLength
    ) {
      throw invalidPng(slideNumber);
    }
    return {
      bytes: result.bytes,
      byteLength: inspected.byteLength,
      sha256: inspected.sha256,
      widthPx: inspected.width,
      heightPx: inspected.height,
    };
  } catch (error) {
    if (error instanceof SlidesPageRasterizationError) {
      throw error;
    }
    throw invalidPng(slideNumber);
  }
}

function mapRasterFailure(
  code: SlideRasterErrorCode,
  slideNumber: number,
): SlidesPageRasterizationError {
  switch (code) {
    case 'slides.raster.invalid_request':
      return new SlidesPageRasterizationError(
        'slides.page-raster.invalid_request',
        'Presentation page raster request was rejected',
        slideNumber,
      );
    case 'slides.raster.resource_load_failed':
      return new SlidesPageRasterizationError(
        'slides.page-raster.resource_load_failed',
        'Presentation page resources could not be loaded',
        slideNumber,
      );
    case 'slides.raster.render_failed':
    case 'slides.raster.encode_failed':
      return new SlidesPageRasterizationError(
        'slides.page-raster.render_failed',
        'Presentation page rendering failed',
        slideNumber,
      );
  }
}

function invalidPng(slideNumber: number): SlidesPageRasterizationError {
  return new SlidesPageRasterizationError(
    'slides.page-raster.invalid_png',
    'Presentation page worker returned an invalid PNG',
    slideNumber,
  );
}
