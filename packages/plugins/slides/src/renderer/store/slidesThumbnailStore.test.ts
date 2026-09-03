import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { PresentationRenderModel } from '../types/render';

const renderSlideRasterToImageBitmapMock = vi.fn();

vi.mock('../features/slideRasterization', () => ({
  createThumbnailRasterRequest: (
    slide: PresentationRenderModel['slides'][number],
  ) => ({ slide }),
  renderSlideRasterToImageBitmap: renderSlideRasterToImageBitmapMock,
}));

function makeModel(slideIds: string[] = ['s1']): PresentationRenderModel {
  return {
    presentationId: 'deck-1',
    title: 'Deck 1',
    version: 1,
    sourceKind: 'generated',
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    slides: slideIds.map((slideId, index) => ({
      slideId,
      index,
      layoutKey: 'structured',
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

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('slidesThumbnailStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.stubGlobal('window', {
      location: new URL('http://localhost/'),
      electronAPI: {
        onApiPortSet: vi.fn(),
      },
    });
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
      const deadline: IdleDeadline = {
        didTimeout: false,
        timeRemaining: () => 10,
      };
      callback(deadline);
      return 1;
    });
  });

  it('always uses the shared raster feature even if unrelated query params are present', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    renderSlideRasterToImageBitmapMock.mockResolvedValue(bitmap);
    vi.stubGlobal('window', {
      location: new URL('http://localhost/?foo=bar&slidesThumbnailPerf=0'),
      electronAPI: {
        onApiPortSet: vi.fn(),
      },
    });

    const { useSlidesRenderStore } = await import('./slidesRenderStore');
    const { useSlidesThumbnailStore } = await import('./slidesThumbnailStore');
    const renderStore = useSlidesRenderStore();
    const thumbnailStore = useSlidesThumbnailStore();

    renderStore.renderModel = makeModel();
    thumbnailStore.regenerateAll();
    await flushPromises();

    expect(renderSlideRasterToImageBitmapMock).toHaveBeenCalled();
  });

  it('uses the shared raster feature by default in development', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    renderSlideRasterToImageBitmapMock.mockResolvedValue(bitmap);

    const { useSlidesRenderStore } = await import('./slidesRenderStore');
    const { useSlidesThumbnailStore } = await import('./slidesThumbnailStore');
    const renderStore = useSlidesRenderStore();
    const thumbnailStore = useSlidesThumbnailStore();

    renderStore.renderModel = makeModel();
    thumbnailStore.regenerateAll();
    await flushPromises();

    expect(renderSlideRasterToImageBitmapMock).toHaveBeenCalled();
  });

  it('generates thumbnails when the store is created after renderModel already exists', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    renderSlideRasterToImageBitmapMock.mockResolvedValue(bitmap);

    const { useSlidesRenderStore } = await import('./slidesRenderStore');
    const renderStore = useSlidesRenderStore();
    renderStore.renderModel = makeModel();

    const { useSlidesThumbnailStore } = await import('./slidesThumbnailStore');
    const thumbnailStore = useSlidesThumbnailStore();
    await flushPromises();

    expect(renderSlideRasterToImageBitmapMock).toHaveBeenCalled();
    expect(thumbnailStore.getThumbnail('s1')).toBe(bitmap);
  });

  it('keeps the previous thumbnail bitmap visible until refreshed bitmap resolves', async () => {
    const secondBitmapLatch: { release: ((bitmap: ImageBitmap) => void) | null } = {
      release: null,
    };
    const firstBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const secondBitmap = { close: vi.fn() } as unknown as ImageBitmap;

    renderSlideRasterToImageBitmapMock
      .mockResolvedValueOnce(firstBitmap)
      .mockImplementationOnce(
        () =>
          new Promise<ImageBitmap>((resolve) => {
            secondBitmapLatch.release = resolve;
          }),
      );

    const { useSlidesRenderStore } = await import('./slidesRenderStore');
    const { useSlidesThumbnailStore } = await import('./slidesThumbnailStore');
    const renderStore = useSlidesRenderStore();
    const thumbnailStore = useSlidesThumbnailStore();

    renderStore.renderModel = makeModel();
    await flushPromises();

    expect(thumbnailStore.getThumbnail('s1')).toBe(firstBitmap);

    thumbnailStore.regenerateAll();
    expect(thumbnailStore.getThumbnail('s1')).toBe(firstBitmap);

    secondBitmapLatch.release?.(secondBitmap);
    await flushPromises();

    expect(thumbnailStore.getThumbnail('s1')).toBe(secondBitmap);
  });

  it('renders the first thumbnail batch immediately before idle scheduling later batches', async () => {
    const immediateBitmaps = new Map([
      ['s1', { close: vi.fn() } as unknown as ImageBitmap],
      ['s2', { close: vi.fn() } as unknown as ImageBitmap],
      ['s3', { close: vi.fn() } as unknown as ImageBitmap],
      ['s4', { close: vi.fn() } as unknown as ImageBitmap],
      ['s5', { close: vi.fn() } as unknown as ImageBitmap],
    ]);

    renderSlideRasterToImageBitmapMock.mockImplementation(async (request) => (
      immediateBitmaps.get(request.slide.slideId) ?? null
    ));

    const requestIdleCallbackSpy = vi.fn(() => 1);
    vi.stubGlobal('requestIdleCallback', requestIdleCallbackSpy);

    const { useSlidesRenderStore } = await import('./slidesRenderStore');
    const { useSlidesThumbnailStore } = await import('./slidesThumbnailStore');
    const renderStore = useSlidesRenderStore();
    const thumbnailStore = useSlidesThumbnailStore();

    renderStore.renderModel = makeModel(['s1', 's2', 's3', 's4', 's5']);
    await flushPromises();

    expect(renderSlideRasterToImageBitmapMock).toHaveBeenCalledTimes(4);
    expect(thumbnailStore.getThumbnail('s1')).toBe(immediateBitmaps.get('s1') ?? null);
    expect(thumbnailStore.getThumbnail('s4')).toBe(immediateBitmaps.get('s4') ?? null);
    expect(thumbnailStore.getThumbnail('s5')).toBeNull();
    expect(requestIdleCallbackSpy).toHaveBeenCalledTimes(1);
  });
});
