import { createApp, h, nextTick, shallowRef } from 'vue';
import type { PresentationRenderModel, ShapeRenderNode, SlideRenderModel } from '../../src/renderer/types/render';
import { createThumbnailRasterRequest, renderSlideRasterToImageBitmap } from '../../src/renderer/features/slideRasterization';
import { createSlideThumbnailRenderer } from '../../src/renderer/features/deckNavigator/orchestration/createSlideThumbnailRenderer';
import { scheduleThumbnailWork } from '../../src/renderer/features/deckNavigator/orchestration/scheduleThumbnailWork';
import { createSlideThumbnailSources } from '../../src/renderer/features/deckNavigator/functions/createSlideThumbnailSources';
import SlideThumbnail from '../../src/renderer/features/deckNavigator/ui/SlideThumbnail.vue';
import type { SlideThumbnailSnapshot } from '../../src/renderer/features/deckNavigator/definitions/slideThumbnails';

const slideSize = { width: 10, height: 5.625, unit: 'in' } satisfies PresentationRenderModel['slideSize'];

function pages(): SlideRenderModel[] {
  return Array.from({ length: 30 }, (_, index) => ({
    slideId: `s${index + 1}`, index, layoutKey: 'structured',
    background: { paint: { type: 'solid', color: '#FFFFFF' } },
    elements: Array.from({ length: 18 }, (_, item): ShapeRenderNode => ({
      id: `s${index + 1}:shape-${item}`, kind: 'shape', zIndex: item,
      box: { x: (item % 6) * 1.5 + 0.2, y: Math.floor(item / 6) * 1.5 + 0.2, w: 1.2, h: 1, unit: 'in' },
      geometry: { type: 'preset', name: 'rect' },
      fill: { type: 'solid', color: `#${((index + 1) * 654321 + item * 1234).toString(16).padStart(6, '0').slice(-6)}` },
    })),
  }));
}

function model(slides: SlideRenderModel[]): PresentationRenderModel {
  return { presentationId: 'thumbnail-smoke', title: '30 pages / 540 shapes', version: 1,
    sourceKind: 'generated', slideSize,
    slides: slides.map((slide, index) => ({ ...slide, index, slideId: `s${index + 1}` })),
    capabilities: { hasSemanticRender: true, hasReferencePreview: false, hasHitTest: false, hasSelection: false } };
}

export async function verifyIncrementalThumbnails() {
  let snapshot: SlideThumbnailSnapshot = { cache: new Map(), readySlides: new Map(), failedSlideIds: [], generating: false };
  let settled: (() => void) | null = null;
  let rasterCount = 0;
  let rasterMs = 0;
  let failure: unknown;
  const displayed = shallowRef<ImageBitmap | null>(null);
  const host = document.createElement('div'); document.body.append(host);
  const app = createApp({ render: () => h(SlideThumbnail, { width: 128, height: 72, bitmap: displayed.value }) });
  app.mount(host);
  const runtime = createSlideThumbnailRenderer({
    schedule: scheduleThumbnailWork,
    render: async (request, signal) => {
      rasterCount++;
      const start = performance.now();
      const bitmap = await renderSlideRasterToImageBitmap(request, signal);
      rasterMs += performance.now() - start;
      return bitmap;
    },
    publish: value => { snapshot = value; if (!value.generating) settled?.(); },
    reportFailure: (_slideId, error) => { failure = error; },
  });

  async function update(slides: SlideRenderModel[], expectedRasters: number) {
    const previousCount = rasterCount;
    const previousMs = rasterMs;
    const startedAt = performance.now();
    const done = new Promise<void>(resolve => { settled = resolve; });
    runtime.update(createSlideThumbnailSources(model(slides)), 128);
    const reconcileMs = performance.now() - startedAt;
    await done;
    if (failure) throw failure;
    if (rasterCount - previousCount !== expectedRasters) throw new Error(`Expected ${expectedRasters} rasters; got ${rasterCount - previousCount}`);
    return { renderedPages: rasterCount - previousCount, reconcileMs, rasterMs: rasterMs - previousMs, elapsedMs: performance.now() - startedAt };
  }

  async function verifyPixels(slides: SlideRenderModel[], index: number) {
    displayed.value = snapshot.cache.get(`s${index + 1}`) ?? null;
    await nextTick(); await nextTick();
    const actual = host.querySelector('canvas');
    if (!actual) throw new Error('Thumbnail canvas missing');
    const fresh = await renderSlideRasterToImageBitmap(createThumbnailRasterRequest(model(slides).slides[index], slideSize, 128, 2));
    const expected = document.createElement('canvas'); expected.width = actual.width; expected.height = actual.height;
    const ctx = expected.getContext('2d'), actualCtx = actual.getContext('2d');
    if (!ctx || !actualCtx) throw new Error('Canvas context missing');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(fresh, 0, 0, expected.width, expected.height);
    fresh.close();
    const expectedPixels = ctx.getImageData(0, 0, expected.width, expected.height).data;
    const actualPixels = actualCtx.getImageData(0, 0, actual.width, actual.height).data;
    if (!expectedPixels.every((byte, offset) => byte === actualPixels[offset])) throw new Error(`Stale thumbnail pixels at page ${index + 1}`);
  }

  try {
    const original = pages();
    const initial = await update(original, 30);
    // 同一真实 raster core 的全量刷新作为参考；不把 IPC/编译延迟混入缩略图指标。
    const baselineStart = performance.now();
    for (const slide of original) (await renderSlideRasterToImageBitmap(createThumbnailRasterRequest(slide, slideSize, 128, 2))).close();
    const fullRefreshMs = performance.now() - baselineStart;
    const blank: SlideRenderModel = { ...original[0], elements: [] };
    const inserted = [original[0], blank, ...original.slice(1)];
    const insert = await update(inserted, 1);
    await verifyPixels(inserted, 1); await verifyPixels(inserted, 2);
    const copied = [inserted[0], inserted[0], ...inserted.slice(1)];
    const duplicate = await update(copied, 0);
    await verifyPixels(copied, 1);
    const deleted = copied.slice(1);
    const deletion = await update(deleted, 0);
    await verifyPixels(deleted, 0);
    const edited = deleted.map((slide, index): SlideRenderModel => index === 0
      ? { ...slide, background: { paint: { type: 'solid', color: '#222222' } } } : slide);
    const edit = await update(edited, 1);
    await verifyPixels(edited, 0);
    return { initial, fullRefreshMs, insert, duplicate, deletion, edit, pixelChecks: 5 };
  } finally {
    app.unmount(); host.remove(); runtime.clear();
  }
}
