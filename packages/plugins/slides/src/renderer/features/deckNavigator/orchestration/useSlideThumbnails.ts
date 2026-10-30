import { useSlideThumbnailResources } from './useSlideThumbnailResources';
import { onScopeDispose, watch } from 'vue';
import { useSlidesRenderStore } from '../../../store/slidesRenderStore';
import { useSlidesStore } from '../../documentRuntime';
import { resolveFilmstripThumbnailSize } from '../../../shared/thumbnailGeometry';
import { logSlidesVerbose, warnSlides } from '../../../shared/diagnosticLogging';
import { renderSlideRasterToImageBitmap } from '../../slideRasterization';
import { createSlideThumbnailSources } from '../functions/createSlideThumbnailSources';
import { useSlidesThumbnailStore } from '../store/slidesThumbnailStore';
import { createSlideThumbnailRenderer } from './createSlideThumbnailRenderer';
import { scheduleThumbnailWork } from './scheduleThumbnailWork';
import type { SlideThumbnailSource } from '../definitions/slideThumbnails';

/** 由 SlidesView 挂载一次；列表与平铺只读同一份展示状态。 */
export function useSlideThumbnails(): void {
  const slides = useSlidesStore();
  const render = useSlidesRenderStore();
  const thumbnails = useSlidesThumbnailStore();
  let sources: readonly SlideThumbnailSource[] = [];
  const renderer = createSlideThumbnailRenderer({
    render: async (request, signal) => {
      const startedAt = performance.now();
      const bitmap = await renderSlideRasterToImageBitmap(request, signal);
      logSlidesVerbose('Thumbnail', 'Rendered changed page', {
        slideId: request.slide.slideId, elapsedMs: performance.now() - startedAt,
      });
      return bitmap;
    },
    schedule: scheduleThumbnailWork,
    publish: useSlideThumbnailResources().applySnapshot,
    reportFailure: (slideId, error) => warnSlides('Thumbnail', 'Page raster failed', { slideId, error }),
  });

  function reconcile(): void {
    const model = render.renderModel;
    if (!model || model.presentationId !== slides.currentDeckId) return;
    renderer.update(sources, Math.max(
      resolveFilmstripThumbnailSize(model.slideSize).width, thumbnails.requestedRasterWidth,
    ));
  }

  watch(() => slides.currentDeckId, () => {
    renderer.clear();
    sources = [];
    thumbnails.$reset();
  }, { flush: 'sync' });
  watch(() => render.renderModel, model => {
    if (!model || model.presentationId !== slides.currentDeckId) {
      renderer.clear();
      sources = [];
      return;
    }
    sources = createSlideThumbnailSources(model);
    reconcile();
  }, { immediate: true, flush: 'sync' });
  watch(() => thumbnails.requestedRasterWidth, reconcile);
  watch(() => render.renderModel?.slides[slides.currentSlideIndex]?.slideId ?? null,
    renderer.prioritize, { immediate: true });
  onScopeDispose(() => {
    renderer.clear();
    thumbnails.$reset();
  });
}
