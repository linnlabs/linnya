import { describe, expect, it, vi } from 'vitest';
import type { PresentationRenderModel } from '@plugin/slides/shared';
import type { SlideRasterRequest } from '@plugin/slides/shared/slideRasterization';
import { PresentationPageRasterizationRuntime } from './PresentationPageRasterizationRuntime';

const inspectImageBytesMock = vi.hoisted(() => vi.fn());

vi.mock('@plugin/backend/imageInspection', () => ({
  inspectImageBytes: inspectImageBytesMock,
}));

function createRenderModel(): PresentationRenderModel {
  return {
    presentationId: 'deck-1',
    title: 'Deck',
    version: 1,
    sourceKind: 'generated',
    slideSize: { width: 10, height: 5, unit: 'in' },
    slides: [1, 2].map(index => ({
      slideId: `slide-${index}`,
      index: index - 1,
      layoutKey: 'blank',
      background: { color: '#FFFFFF' },
      elements: [],
    })),
    capabilities: {
      hasSemanticRender: true,
      hasReferencePreview: false,
      hasHitTest: true,
      hasSelection: true,
    },
  };
}

describe('PresentationPageRasterizationRuntime', () => {
  it('distinguishes an extreme-aspect pixel budget failure from an invalid document size', async () => {
    const model = createRenderModel();
    model.slideSize = { width: 1, height: 56, unit: 'in' };
    const runtime = new PresentationPageRasterizationRuntime();

    await expect(runtime.render({
      source: { renderModel: model },
      slideNumbers: [1],
      profile: {
        id: 'default-cli',
        viewportWidthPx: 1600,
        viewportHeightPx: 89600,
        pixelRatio: 1,
        format: 'png',
      },
    })).rejects.toMatchObject({
      code: 'slides.page-raster.pixel_budget_exceeded',
    });
  });

  it('每验证完成一页就按请求顺序报告一次真实进度', async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    inspectImageBytesMock.mockResolvedValue({
      mediaType: 'image/png',
      width: 100,
      height: 50,
      byteLength: bytes.byteLength,
      sha256: 'page-hash',
    });
    const invokeRasterWorker = vi.fn(async (request: SlideRasterRequest) => ({
      status: 'success' as const,
      requestId: request.requestId,
      format: 'png' as const,
      widthPx: 100,
      heightPx: 50,
      bytes,
    }));
    const onPageCompleted = vi.fn();
    const runtime = new PresentationPageRasterizationRuntime({
      invokeRasterWorker,
      createRunId: () => 'run-1',
    });

    await runtime.render({
      source: { renderModel: createRenderModel() },
      slideNumbers: [1, 2],
      profile: {
        id: 'test-profile',
        viewportWidthPx: 100,
        viewportHeightPx: 50,
        pixelRatio: 1,
        format: 'png',
      },
    }, { onPageCompleted });

    expect(onPageCompleted).toHaveBeenNthCalledWith(1, {
      completedPages: 1,
      totalPages: 2,
    });
    expect(onPageCompleted).toHaveBeenNthCalledWith(2, {
      completedPages: 2,
      totalPages: 2,
    });
  });
});
