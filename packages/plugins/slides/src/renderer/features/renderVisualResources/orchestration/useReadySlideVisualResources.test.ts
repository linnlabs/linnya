// @vitest-environment jsdom

import {
  effectScope,
  nextTick,
  ref,
} from 'vue';
import { describe, expect, it } from 'vitest';
import type { SlideRenderModel } from '../../../types/render';
import type { LoadedRenderChart } from '../../renderChartResources';
import type { LoadedRenderImage } from '../../renderImageResources';
import type { SlideVisualResources } from '../definitions/slideVisualResources';
import {
  useReadySlideVisualResources,
  type ReadySlideVisualResourcesController,
} from './useReadySlideVisualResources';

interface ResourceLatch {
  resolve: (resources: SlideVisualResources) => void;
  reject: (error: Error) => void;
}

function createSlide(slideId: string, index: number): SlideRenderModel {
  return {
    slideId,
    index,
    layoutKey: 'structured',
    background: { paint: { type: 'solid', color: '#FFFFFF' } },
    elements: [],
  };
}

function createVisualResources(label: string): SlideVisualResources {
  const image = document.createElement('img');
  const loadedImage: LoadedRenderImage = {
    image,
    naturalWidth: 320,
    naturalHeight: 180,
  };
  const loadedChart: LoadedRenderChart = {
    image,
    naturalWidth: 320,
    naturalHeight: 180,
  };
  return {
    imageResources: new Map([[`image-${label}`, loadedImage]]),
    chartResources: new Map([[`chart-${label}`, loadedChart]]),
  };
}

function requireController(
  controller: ReadySlideVisualResourcesController | null,
): ReadySlideVisualResourcesController {
  if (!controller) {
    throw new Error('Expected visual readiness controller inside the effect scope.');
  }
  return controller;
}

describe('useReadySlideVisualResources', () => {
  it('keeps the previous complete frame until target images and charts are both ready', async () => {
    const first = createSlide('s1', 0);
    const second = createSlide('s2', 1);
    const targetSlide = ref<SlideRenderModel | null>(first);
    const allSlides = ref<readonly SlideRenderModel[]>([first, second]);
    const latches = new Map<string, ResourceLatch>();
    const loadResources = (slide: SlideRenderModel): Promise<SlideVisualResources> => (
      new Promise((resolve, reject) => latches.set(slide.slideId, { resolve, reject }))
    );
    const scope = effectScope();
    let maybeController: ReadySlideVisualResourcesController | null = null;
    scope.run(() => {
      maybeController = useReadySlideVisualResources({
        targetSlide,
        allSlides,
        loadResources,
        prewarmAdjacent: false,
      });
    });
    const controller = requireController(maybeController);

    latches.get('s1')?.resolve(createVisualResources('s1'));
    await nextTick();
    await nextTick();
    expect(controller.displayedSlide.value?.slideId).toBe('s1');
    expect(controller.imageResources.value.has('image-s1')).toBe(true);
    expect(controller.chartResources.value.has('chart-s1')).toBe(true);

    targetSlide.value = second;
    await nextTick();
    expect(controller.preparing.value).toBe(true);
    expect(controller.displayedSlide.value?.slideId).toBe('s1');
    expect(controller.imageResources.value.has('image-s1')).toBe(true);
    expect(controller.chartResources.value.has('chart-s1')).toBe(true);

    latches.get('s2')?.resolve(createVisualResources('s2'));
    await nextTick();
    await nextTick();
    expect(controller.displayedSlide.value?.slideId).toBe('s2');
    expect(controller.imageResources.value.has('image-s2')).toBe(true);
    expect(controller.chartResources.value.has('chart-s2')).toBe(true);
    expect(controller.imageResources.value.has('image-s1')).toBe(false);
    expect(controller.chartResources.value.has('chart-s1')).toBe(false);
    scope.stop();
  });

  it('aborts stale consumers and never commits an intermediate page after rapid A to B to C navigation', async () => {
    const first = createSlide('s1', 0);
    const second = createSlide('s2', 1);
    const third = createSlide('s3', 2);
    const targetSlide = ref<SlideRenderModel | null>(first);
    const allSlides = ref<readonly SlideRenderModel[]>([first, second, third]);
    const latches = new Map<string, ResourceLatch>();
    const signals = new Map<string, AbortSignal | undefined>();
    const loadResources = (
      slide: SlideRenderModel,
      options?: { signal?: AbortSignal },
    ): Promise<SlideVisualResources> => {
      signals.set(slide.slideId, options?.signal);
      return new Promise((resolve, reject) => latches.set(slide.slideId, { resolve, reject }));
    };
    const scope = effectScope();
    let maybeController: ReadySlideVisualResourcesController | null = null;
    scope.run(() => {
      maybeController = useReadySlideVisualResources({
        targetSlide,
        allSlides,
        loadResources,
        prewarmAdjacent: false,
      });
    });
    const controller = requireController(maybeController);

    latches.get('s1')?.resolve(createVisualResources('s1'));
    await nextTick();
    await nextTick();
    targetSlide.value = second;
    await nextTick();
    targetSlide.value = third;
    await nextTick();

    expect(signals.get('s2')?.aborted).toBe(true);
    latches.get('s2')?.resolve(createVisualResources('s2'));
    await nextTick();
    expect(controller.displayedSlide.value?.slideId).toBe('s1');

    latches.get('s3')?.resolve(createVisualResources('s3'));
    await nextTick();
    await nextTick();
    expect(controller.displayedSlide.value?.slideId).toBe('s3');
    expect(controller.chartResources.value.has('chart-s3')).toBe(true);
    scope.stop();
  });

  it('exposes a fatal preparation failure instead of leaving an unexplained empty frame', async () => {
    const slide = createSlide('s1', 0);
    const targetSlide = ref<SlideRenderModel | null>(slide);
    const allSlides = ref<readonly SlideRenderModel[]>([slide]);
    const failure = new Error('visual preparation failed');
    let rejectPreparation: ((error: Error) => void) | null = null;
    const scope = effectScope();
    let maybeController: ReadySlideVisualResourcesController | null = null;
    scope.run(() => {
      maybeController = useReadySlideVisualResources({
        targetSlide,
        allSlides,
        loadResources: () => new Promise((_, reject) => {
          rejectPreparation = reject;
        }),
        prewarmAdjacent: false,
      });
    });
    const controller = requireController(maybeController);

    rejectPreparation?.(failure);
    await Promise.resolve();
    await nextTick();

    expect(controller.preparing.value).toBe(false);
    expect(controller.preparationFailed.value).toBe(true);
    expect(controller.displayedSlide.value).toBeNull();
    scope.stop();
  });
});
