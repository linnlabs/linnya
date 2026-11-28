<template>
  <section
    ref="preview"
    class="slides-readonly-preview"
    tabindex="0"
    :aria-label="labels.readonly"
    @keydown="navigate"
  >
    <div
      class="slides-readonly-stage"
      :aria-busy="state.phase === 'loading'"
    >
      <PresentationBitmapCanvas
        v-if="state.bitmap"
        :bitmap="state.bitmap"
      />
      <!-- 自己的画面出来之前沿用封面图，同一位置同一尺寸，展开时不空白一帧。 -->
      <img
        v-else-if="cover && state.phase === 'loading'"
        class="slides-readonly-canvas"
        :src="cover.dataUri"
        :width="cover.widthPx"
        :height="cover.heightPx"
        alt=""
        decoding="sync"
      >
      <p
        v-if="state.phase === 'loading' && !cover"
        role="status"
      >
        {{ labels.loading }}
      </p>
      <p
        v-else-if="state.phase === 'failed'"
        role="alert"
      >
        {{ labels.failed }}
      </p>
      <p v-else-if="state.phase === 'empty'">
        {{ labels.empty }}
      </p>
      <nav
        v-if="pageCount"
        class="slides-readonly-navigation"
        :aria-label="labels.pages"
      >
        <button
          type="button"
          :disabled="!hasPrevious"
          :aria-label="labels.previous"
          @click="selectPage(state.pageIndex - 1)"
        >
          <ChevronIcon direction="left" />
        </button>
        <span aria-live="polite">{{ state.pageIndex + 1 }} / {{ pageCount }}</span>
        <button
          type="button"
          :disabled="!hasNext"
          :aria-label="labels.next"
          @click="selectPage(state.pageIndex + 1)"
        >
          <ChevronIcon direction="right" />
        </button>
      </nav>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';
import {
  createThumbnailRasterRequest,
  renderSlideRasterToImageBitmap,
} from '../../slideRasterization';
import { createPresentationPreviewController } from '../orchestration/createPresentationPreviewController';
import type {
  PresentationPreviewCover,
  PresentationPreviewState,
  PresentationPreviewLabels,
} from '../definitions/presentationPreview';
import PresentationBitmapCanvas from './PresentationBitmapCanvas.vue';
const props = defineProps<{
  read: () => Promise<PresentationRenderModel>;
  labels: PresentationPreviewLabels;
  autofocus?: boolean;
  /** 第一页的现成封面；有它时读取期间显示封面而不是“正在生成”。 */
  cover?: PresentationPreviewCover;
}>();
const state = shallowRef<PresentationPreviewState>({
  model: null,
  bitmap: null,
  pageIndex: 0,
  phase: 'loading',
});
const preview = ref<HTMLElement | null>(null);
const pageCount = computed(() => state.value.model?.slides.length ?? 0);
const hasPrevious = computed(() => state.value.pageIndex > 0);
const hasNext = computed(() => state.value.pageIndex + 1 < pageCount.value);
const controller = createPresentationPreviewController({
  read: props.read,
  render: (model, index, signal) => {
    const width = Math.min(900, (600 * model.slideSize.width) / model.slideSize.height);
    return renderSlideRasterToImageBitmap(
      createThumbnailRasterRequest(model.slides[index], model.slideSize, width, 1),
      signal
    );
  },
  publish: value => {
    state.value = value;
  },
  report: error => console.warn('[Slides/ReadonlyPreview] Preview failed', error),
});
function selectPage(index: number) {
  // 切到首尾时按钮可能被禁用，焦点留在预览区域继续接收方向键。
  preview.value?.focus({ preventScroll: true });
  void controller.select(index);
}
function navigate(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  event.stopPropagation();
  selectPage(state.value.pageIndex + (event.key === 'ArrowLeft' ? -1 : 1));
}
onMounted(() => {
  if (props.autofocus) preview.value?.focus({ preventScroll: true });
  void controller.load();
});
onBeforeUnmount(controller.dispose);
</script>
