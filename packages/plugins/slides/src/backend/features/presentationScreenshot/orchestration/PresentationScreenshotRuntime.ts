import path from 'node:path';
import {
  createAspectRatioSlideRasterProfile,
  isSlideRasterPixelSizeWithinBudget,
  resolveSlideRasterPixelSize,
  type SlideRasterRequest,
  type SlideRasterResult,
} from '@plugin/slides/shared/slideRasterization';
import {
  PresentationPageRasterizationRuntime,
  SlidesPageRasterizationError,
} from '../../presentationPageRasterization';
import {
  SlidesScreenshotError,
  type PresentationScreenshotRequest,
  type PresentationScreenshotResult,
  type PresentationScreenshotSlide,
  type PresentationScreenshotSource,
} from '../definitions/presentationScreenshot';
import {
  createScreenshotFileName,
  resolveScreenshotSlideNumbers,
} from '../functions/resolveScreenshotSlideNumbers';
import {
  createDirectoryScreenshotOutputSession,
  createLatestVersionScreenshotOutputSession,
  type PresentationScreenshotOutputSession,
} from '../infrastructure/presentationScreenshotOutput';
import { resolveManagedScreenshotIdentity } from '../functions/resolveManagedScreenshotIdentity';
import { encodeScreenshotPage } from '../functions/encodeScreenshotPage';

export interface PresentationScreenshotRuntimeDeps {
  readonly loadSource: (presentationId: string) => Promise<PresentationScreenshotSource>;
  readonly invokeRasterWorker?: (
    request: SlideRasterRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<SlideRasterResult>;
  readonly createRunId?: () => string;
}

export class PresentationScreenshotRuntime {
  private readonly pageRasterization: PresentationPageRasterizationRuntime;

  constructor(private readonly deps: PresentationScreenshotRuntimeDeps) {
    this.pageRasterization = new PresentationPageRasterizationRuntime({
      ...(deps.invokeRasterWorker ? { invokeRasterWorker: deps.invokeRasterWorker } : {}),
      ...(deps.createRunId ? { createRunId: deps.createRunId } : {}),
    });
  }

  async render(
    request: PresentationScreenshotRequest,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<PresentationScreenshotResult> {
    options.signal?.throwIfAborted();
    assertScreenshotRequest(request);
    const source = await this.deps.loadSource(request.presentationId);
    options.signal?.throwIfAborted();
    assertSourceIdentity(request.presentationId, source);
    const slideNumbers = resolveScreenshotSlideNumbers(
      request.selection,
      source.renderModel.slides.length,
    );
    const fileNames = slideNumbers.map((slideNumber) => (
      createScreenshotFileName(slideNumber, request.encoding)
    ));
    const profile = createAspectRatioSlideRasterProfile({
      id: request.profile.id,
      slideSize: source.renderModel.slideSize,
      viewportWidthPx: request.profile.viewportWidthPx,
      pixelRatio: request.profile.pixelRatio,
    });
    const pixelSize = resolveSlideRasterPixelSize(profile);
    if (!isSlideRasterPixelSizeWithinBudget(pixelSize)) {
      throw new SlidesScreenshotError(
        'slides.screenshot.pixel_budget_exceeded',
        'Screenshot output exceeds the pixel limit',
      );
    }
    const output = await createScreenshotOutputSession(request, source, fileNames);
    const slides: PresentationScreenshotSlide[] = [];
    try {
      const rasterized = await this.pageRasterization.render(
        { source, slideNumbers, profile },
        options.signal ? { signal: options.signal } : undefined,
      );
      for (const page of rasterized.pages) {
        const fileName = createScreenshotFileName(page.slideNumber, request.encoding);
        const bytes = await encodeScreenshotPage(page.bytes, request.encoding);
        await output.writeSlide(fileName, bytes);
        slides.push({
          slideNumber: page.slideNumber,
          relativePath: output.relativeRoot
            ? path.posix.join(output.relativeRoot, fileName)
            : fileName,
        });
      }

      options.signal?.throwIfAborted();
      await output.commit(options.signal ? { signal: options.signal } : undefined);
      return {
        presentation: source.identity,
        requestedSlideNumbers: [...slideNumbers],
        slides,
      };
    } catch (error) {
      await output.dispose();
      if (options.signal?.aborted) throw error;
      throw normalizeScreenshotError(error);
    }
  }
}

async function createScreenshotOutputSession(
  request: PresentationScreenshotRequest,
  source: PresentationScreenshotSource,
  fileNames: readonly string[],
): Promise<PresentationScreenshotOutputSession> {
  if (request.output.kind === 'directory') {
    return createDirectoryScreenshotOutputSession({
      outputRoot: request.output.root,
      fileNames,
      overwrite: request.output.overwrite,
    });
  }

  return createLatestVersionScreenshotOutputSession({
    presentationRoot: request.output.root,
    identity: resolveManagedScreenshotIdentity({
      source: source.identity,
      profile: request.profile,
      encoding: request.encoding,
    }),
    versionNumber: source.identity.versionNumber,
    fileNames,
  });
}

function normalizeScreenshotError(error: unknown): SlidesScreenshotError {
  if (error instanceof SlidesScreenshotError) return error;
  if (error instanceof SlidesPageRasterizationError) {
    switch (error.code) {
      case 'slides.page-raster.pixel_budget_exceeded':
        return new SlidesScreenshotError(
          'slides.screenshot.pixel_budget_exceeded',
          'Screenshot output exceeds the pixel limit',
          error.slideNumber,
        );
      case 'slides.page-raster.invalid_request':
        return new SlidesScreenshotError(
          'slides.screenshot.invalid_request',
          'Screenshot raster request was rejected',
          error.slideNumber,
        );
      case 'slides.page-raster.resource_load_failed':
        return new SlidesScreenshotError(
          'slides.screenshot.resource_load_failed',
          'Screenshot resources could not be loaded',
          error.slideNumber,
        );
      case 'slides.page-raster.render_failed':
        return new SlidesScreenshotError(
          'slides.screenshot.render_failed',
          'Screenshot rendering failed',
          error.slideNumber,
        );
      case 'slides.page-raster.invalid_png':
        return new SlidesScreenshotError(
          'slides.screenshot.invalid_png',
          'Screenshot worker returned an invalid PNG',
          error.slideNumber,
        );
    }
  }
  return new SlidesScreenshotError(
    'slides.screenshot.render_failed',
    'Screenshot rendering failed',
  );
}

function assertScreenshotRequest(request: PresentationScreenshotRequest): void {
  if (!request.presentationId.trim() || !request.profile.id.trim()) {
    throw new SlidesScreenshotError(
      'slides.screenshot.invalid_request',
      'Screenshot presentation and profile ids are required',
    );
  }
  if (
    !Number.isFinite(request.profile.viewportWidthPx)
    || request.profile.viewportWidthPx <= 0
    || !Number.isFinite(request.profile.pixelRatio)
    || request.profile.pixelRatio <= 0
  ) {
    throw new SlidesScreenshotError(
      'slides.screenshot.invalid_request',
      'Screenshot profile dimensions are invalid',
    );
  }
}

function assertSourceIdentity(
  requestedPresentationId: string,
  source: PresentationScreenshotSource,
): void {
  if (
    source.identity.presentationId !== requestedPresentationId
    || source.renderModel.presentationId !== requestedPresentationId
    || source.renderModel.version !== source.identity.versionNumber
    || source.renderModel.sourceKind !== source.identity.sourceKind
    || source.renderModel.title !== source.identity.title
  ) {
    throw new SlidesScreenshotError(
      'slides.screenshot.invalid_request',
      'Screenshot source identity is inconsistent',
    );
  }
}
