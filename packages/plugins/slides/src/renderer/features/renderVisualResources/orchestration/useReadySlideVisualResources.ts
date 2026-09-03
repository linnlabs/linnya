import {
  computed,
  onScopeDispose,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from 'vue';
import type { SlideRenderModel } from '../../../types/render';
import { warnSlides } from '../../../shared/diagnosticLogging';
import type { SlideChartResourceMap } from '../../renderChartResources';
import type { SlideImageResourceMap } from '../../renderImageResources';
import type { ReadySlideVisualFrame } from '../definitions/slideVisualResources';
import { loadSlideVisualResources } from './loadSlideVisualResources';

const EMPTY_IMAGE_RESOURCES: SlideImageResourceMap = new Map();
const EMPTY_CHART_RESOURCES: SlideChartResourceMap = new Map();

export interface ReadySlideVisualResourcesController {
  displayedSlide: ComputedRef<SlideRenderModel | null>;
  imageResources: ComputedRef<SlideImageResourceMap>;
  chartResources: ComputedRef<SlideChartResourceMap>;
  preparing: ShallowRef<boolean>;
  preparationFailed: ShallowRef<boolean>;
}

export interface UseReadySlideVisualResourcesOptions {
  targetSlide: Readonly<Ref<SlideRenderModel | null>>;
  allSlides: Readonly<Ref<readonly SlideRenderModel[]>>;
  loadResources?: typeof loadSlideVisualResources;
  prewarmAdjacent?: boolean;
  schedulePrewarm?: (work: () => void) => void;
}

/**
 * 目标页图片和图表全部成功或明确失败后，一次替换完整视觉帧。
 * 快速切页时 AbortSignal 只取消旧消费者的提交资格，共享缓存中的工作继续服务其他消费者。
 */
export function useReadySlideVisualResources(
  options: UseReadySlideVisualResourcesOptions,
): ReadySlideVisualResourcesController {
  const loadResources = options.loadResources ?? loadSlideVisualResources;
  const frame = shallowRef<ReadySlideVisualFrame | null>(null);
  const preparing = shallowRef(false);
  const preparationFailed = shallowRef(false);
  let requestId = 0;
  let activeController: AbortController | null = null;

  watch(
    options.targetSlide,
    (slide) => {
      requestId += 1;
      const currentRequestId = requestId;
      activeController?.abort();
      activeController = null;

      if (!slide) {
        frame.value = null;
        preparing.value = false;
        preparationFailed.value = false;
        return;
      }

      const controller = new AbortController();
      activeController = controller;
      preparing.value = true;
      preparationFailed.value = false;
      void loadResources(slide, {
        failureMode: 'omit',
        signal: controller.signal,
      }).then((resources) => {
        if (controller.signal.aborted || currentRequestId !== requestId) return;
        frame.value = { slide, ...resources };
        preparing.value = false;
        preparationFailed.value = false;
        activeController = null;
        if (options.prewarmAdjacent !== false) {
          const schedule = options.schedulePrewarm ?? scheduleIdlePrewarm;
          schedule(() => prewarmAdjacentSlides(slide, options.allSlides.value, loadResources));
        }
      }).catch((error: unknown) => {
        if (controller.signal.aborted || currentRequestId !== requestId) return;
        preparing.value = false;
        preparationFailed.value = true;
        activeController = null;
        warnSlides('RenderVisualResources', '准备页面视觉资源失败', {
          slideId: slide.slideId,
          error,
        });
      });
    },
    { immediate: true, flush: 'sync' },
  );

  onScopeDispose(() => {
    requestId += 1;
    activeController?.abort();
    activeController = null;
  });

  return {
    displayedSlide: computed(() => frame.value?.slide ?? null),
    imageResources: computed(() => frame.value?.imageResources ?? EMPTY_IMAGE_RESOURCES),
    chartResources: computed(() => frame.value?.chartResources ?? EMPTY_CHART_RESOURCES),
    preparing,
    preparationFailed,
  };
}

function scheduleIdlePrewarm(work: () => void): void {
  globalThis.requestIdleCallback(work);
}

function prewarmAdjacentSlides(
  currentSlide: SlideRenderModel,
  slides: readonly SlideRenderModel[],
  loadResources: typeof loadSlideVisualResources,
): void {
  const adjacentSlides = [
    slides[currentSlide.index - 1],
    slides[currentSlide.index + 1],
  ].filter((slide): slide is SlideRenderModel => slide !== undefined);

  for (const slide of adjacentSlides) {
    void loadResources(slide, { failureMode: 'omit' }).catch((error: unknown) => {
      warnSlides('RenderVisualResources', '预热相邻页面视觉资源失败', {
        slideId: slide.slideId,
        error,
      });
    });
  }
}
