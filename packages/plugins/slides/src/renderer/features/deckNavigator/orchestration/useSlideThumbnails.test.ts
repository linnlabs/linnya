// @vitest-environment jsdom
import { installTestPresentation } from '../../documentRuntime/testing/installTestPresentation';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, nextTick } from 'vue';
import type { PresentationRenderModel } from '../../../types/render';
import type { SlideRasterRequest } from '../../../../shared/slideRasterization';
import { useSlidesThumbnailStore } from '../store/slidesThumbnailStore';
import { useSlideThumbnails } from './useSlideThumbnails';

const raster = vi.hoisted(() => vi.fn<(request: SlideRasterRequest, signal: AbortSignal) => Promise<ImageBitmap>>());
const jobs = vi.hoisted(() => new Set<() => void>());
vi.mock('../../slideRasterization', async importOriginal => ({
  ...await importOriginal<typeof import('../../slideRasterization')>(),
  renderSlideRasterToImageBitmap: raster,
}));
vi.mock('./scheduleThumbnailWork', () => ({
  scheduleThumbnailWork: (job: () => void) => { jobs.add(job); return () => jobs.delete(job); },
}));

function model(documentId = 'deck', version = 1): PresentationRenderModel {
  return { presentationId: documentId, version, title: 'Deck', sourceKind: 'generated',
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    slides: [{ slideId: 's1', index: 0, layoutKey: 'structured', background: { paint: { type: 'solid', color: '#FFFFFF' } }, elements: [] }],
    capabilities: { hasSemanticRender: true, hasReferencePreview: false, hasHitTest: true, hasSelection: true } };
}

async function renderScheduled() {
  await nextTick();
  while (jobs.size) {
    const job = jobs.values().next().value;
    if (job) { jobs.delete(job); job(); }
    await Promise.resolve();
  }
  await nextTick();
}

let scope = effectScope();
beforeEach(() => {
  setActivePinia(createPinia());
  scope = effectScope();
  raster.mockReset().mockImplementation(async () => ({ width: 256, height: 144, close: vi.fn() }));
});
afterEach(() => { scope.stop(); jobs.clear(); });

it('挂载读取现有模型，修订不重画，平铺请求升级分辨率，卸载释放位图', async () => {
  const thumbnails = useSlidesThumbnailStore();
  installTestPresentation({ documentId: 'deck' }); installTestPresentation({ renderModel: model() });
  scope.run(useSlideThumbnails);
  await renderScheduled();
  expect(thumbnails.cachedCount).toBe(1);
  const small = thumbnails.getThumbnail('s1');
  installTestPresentation({ renderModel: model('deck', 2) }); await renderScheduled();
  expect(raster).toHaveBeenCalledTimes(1);
  thumbnails.requestRasterWidth(320); await renderScheduled();
  expect(raster.mock.calls[1]?.[0].profile.viewportWidthPx).toBe(320);
  expect(small?.close).toHaveBeenCalledTimes(1);
  const large = thumbnails.getThumbnail('s1');
  scope.stop();
  expect(large?.close).toHaveBeenCalledTimes(1);
  expect(thumbnails.cachedCount).toBe(0);
  expect(thumbnails.requestedRasterWidth).toBe(0);
});

it('切换文档同步清空展示，不会把仍保留的旧模型重新排队', async () => {
  const thumbnails = useSlidesThumbnailStore();
  installTestPresentation({ documentId: 'deck' }); installTestPresentation({ renderModel: model() });
  scope.run(useSlideThumbnails); await renderScheduled();
  const old = thumbnails.getThumbnail('s1');
  installTestPresentation({ documentId: 'other' });
  expect(thumbnails.cachedCount).toBe(0);
  expect(old?.close).toHaveBeenCalledTimes(1);
  thumbnails.requestRasterWidth(320); await renderScheduled();
  expect(raster).toHaveBeenCalledTimes(1);
  installTestPresentation({ renderModel: model('other') }); await renderScheduled();
  expect(raster).toHaveBeenCalledTimes(2);
  expect(thumbnails.getThumbnail('s1')).not.toBe(old);
  installTestPresentation({ renderModel: null }); await nextTick();
  expect(thumbnails.cachedCount).toBe(0);
});
