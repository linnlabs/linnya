<template>
  <div class="slides-history-preview">
    <CustomSelect
      v-if="state.model?.slides.length"
      :model-value="state.pageIndex"
      :options="pages"
      :disabled="state.phase === 'loading'"
      @update:model-value="selectPage"
    />
    <p v-if="state.phase === 'loading'">{{ message('slides.history.loading') }}</p>
    <p v-else-if="state.phase === 'failed'" role="alert">{{ message('slides.history.failed') }}</p>
    <canvas v-show="state.phase === 'ready'" ref="canvas" class="slides-history-canvas" />
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { CustomSelect } from '@linnya/renderer-ui';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { SLIDES_IPC, SLIDES_PLUGIN_ID } from '@plugin/slides/shared/ipc';
import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';
import { useLocalization } from '@app/localization';
import {
  createThumbnailRasterRequest,
  renderSlideRasterToImageBitmap,
} from '../../slideRasterization';
import {
  createHistoryPreviewController,
  type HistoryPreviewState,
} from '../orchestration/createHistoryPreviewController';
import { SLIDES_HISTORY_FALLBACKS } from '../definitions/historyMessages';

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
const canvas = ref<HTMLCanvasElement | null>(null);
const controller = createHistoryPreviewController({
  read: async () => {
    const response = await invokeRendererPluginIpc<PresentationRenderModel>(
      SLIDES_PLUGIN_ID,
      SLIDES_IPC.historyPreview,
      { documentId: props.documentId, versionId: props.versionId }
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
const pages = computed(
  () =>
    state.value.model?.slides.map((slide, index) => ({
      value: index,
      text: `${index + 1} · ${slide.slideId}`,
    })) ?? []
);
function selectPage(index: unknown) {
  if (typeof index === 'number') void controller.select(index);
}
watch(
  () => state.value.bitmap,
  async bitmap => {
    await nextTick();
    if (!bitmap || bitmap !== state.value.bitmap || !canvas.value) return;
    canvas.value.width = bitmap.width;
    canvas.value.height = bitmap.height;
    canvas.value.getContext('2d')?.drawImage(bitmap, 0, 0);
  }
);
onMounted(() => {
  void controller.load();
});
onBeforeUnmount(() => {
  controller.dispose();
  if (canvas.value) {
    canvas.value.width = 0;
    canvas.value.height = 0;
  }
});
</script>
