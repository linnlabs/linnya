<template>
  <section
    ref="preview"
    class="slides-history-preview"
    tabindex="0"
    :aria-label="message('slides.history.readonly')"
    @keydown="navigate"
  >
    <div class="slides-history-stage" :aria-busy="state.phase === 'loading'">
      <HistoryBitmapCanvas v-if="state.bitmap" :bitmap="state.bitmap" />
      <p v-if="state.phase === 'loading'" role="status">{{ message('slides.history.loading') }}</p>
      <p v-else-if="state.phase === 'failed'" role="alert">
        {{ message('slides.history.failed') }}
      </p>
      <p v-else-if="state.phase === 'empty'">{{ message('slides.history.empty') }}</p>
      <nav
        v-if="pageCount"
        class="slides-history-navigation"
        :aria-label="message('slides.history.pages')"
      >
        <button
          type="button"
          :disabled="!hasPrevious"
          :aria-label="message('slides.history.previous')"
          @click="selectPage(state.pageIndex - 1)"
        >
          <ChevronRightIcon class="slides-history-previous-icon" />
        </button>
        <span aria-live="polite">{{ state.pageIndex + 1 }} / {{ pageCount }}</span>
        <button
          type="button"
          :disabled="!hasNext"
          :aria-label="message('slides.history.next')"
          @click="selectPage(state.pageIndex + 1)"
        >
          <ChevronRightIcon />
        </button>
      </nav>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { ChevronRightIcon } from '@linnya/renderer-ui/icons';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { SLIDES_IPC, SLIDES_PLUGIN_ID } from '@plugin/slides/shared/ipc';
import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';
import { useLocalization } from '@app/localization';
import {
  createThumbnailRasterRequest,
  renderSlideRasterToImageBitmap,
} from '../../slideRasterization';
import { createHistoryPreviewController } from '../orchestration/createHistoryPreviewController';
import type { HistoryPreviewState } from '../definitions/historyPreview';
import { SLIDES_HISTORY_FALLBACKS } from '../definitions/historyMessages';
import HistoryBitmapCanvas from './HistoryBitmapCanvas.vue';

const props = defineProps<{ documentId: string; versionId: string }>();
const localization = useLocalization();
const message = (key: keyof typeof SLIDES_HISTORY_FALLBACKS) =>
  localization.message(key, SLIDES_HISTORY_FALLBACKS[key]);
const state = shallowRef<HistoryPreviewState>({
  model: null,
  bitmap: null,
  pageIndex: 0,
  phase: 'loading',
});
const preview = ref<HTMLElement | null>(null);
const pageCount = computed(() => state.value.model?.slides.length ?? 0);
const hasPrevious = computed(() => state.value.pageIndex > 0);
const hasNext = computed(() => state.value.pageIndex + 1 < pageCount.value);
const controller = createHistoryPreviewController({
  read: async () => {
    const response = await invokeRendererPluginIpc<PresentationRenderModel>(
      SLIDES_PLUGIN_ID,
      SLIDES_IPC.historyPreview,
      {
        documentId: props.documentId,
        versionId: props.versionId,
      }
    );
    if (!response.success) throw new Error(response.error);
    if (!response.data) throw new Error('Empty historical render model');
    return response.data;
  },
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
  report: error => console.warn('[Slides/HistoryPreview] Historical preview failed', error),
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
  preview.value?.focus({ preventScroll: true });
  void controller.load();
});
onBeforeUnmount(controller.dispose);
</script>
