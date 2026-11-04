<template>
  <canvas
    v-show="phase === 'ready'"
    ref="canvas"
    class="slides-version-cover"
    :style="aspectStyle"
  />
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { SLIDES_IPC, SLIDES_PLUGIN_ID } from '@plugin/slides/shared/ipc';
import { SlidesHistoryPreviewSchema, parseSlidesCommand } from '@plugin/slides/shared/ipcCommands';
import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';
import {
  createThumbnailRasterRequest,
  renderSlideRasterToImageBitmap,
} from '../../slideRasterization';

/**
 * 某个成功版本的第 1 页静态图，供计划卡展示封面样张。
 *
 * 复用历史预览的只读 RenderModel 与缩略图栅格化，不写缓存、不订阅当前文稿；
 * 版本被历史维护清理后报告 failed，由调用方退回只显示文字。
 */
const props = defineProps<{ documentId: string; versionId: string; widthPx: number }>();
const emit = defineEmits<{ phase: [value: 'loading' | 'ready' | 'failed'] }>();

const canvas = ref<HTMLCanvasElement | null>(null);
const phase = ref<'loading' | 'ready' | 'failed'>('loading');
const aspect = ref(16 / 9);
const aspectStyle = computed(() => ({ aspectRatio: String(aspect.value) }));
const abort = new AbortController();

function publish(next: 'loading' | 'ready' | 'failed'): void {
  phase.value = next;
  emit('phase', next);
}

onMounted(async () => {
  publish('loading');
  try {
    const response = await invokeRendererPluginIpc<PresentationRenderModel>(
      SLIDES_PLUGIN_ID,
      SLIDES_IPC.historyPreview,
      parseSlidesCommand(SlidesHistoryPreviewSchema, {
        documentId: props.documentId,
        versionId: props.versionId,
      })
    );
    if (!response.success || !response.data) throw new Error(response.success ? 'Empty render model' : response.error);
    const model = response.data;
    const slide = model.slides[0];
    if (!slide) throw new Error('Version has no slides');
    aspect.value = model.slideSize.width / model.slideSize.height;
    const bitmap = await renderSlideRasterToImageBitmap(
      createThumbnailRasterRequest(slide, model.slideSize, props.widthPx, window.devicePixelRatio || 1),
      abort.signal
    );
    const element = canvas.value;
    if (abort.signal.aborted || !element) {
      bitmap.close();
      return;
    }
    element.width = bitmap.width;
    element.height = bitmap.height;
    element.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    publish('ready');
  } catch (error) {
    if (abort.signal.aborted) return;
    console.warn('[Slides/VersionCover] Cover preview failed', error);
    publish('failed');
  }
});

onBeforeUnmount(() => {
  abort.abort();
  if (canvas.value) canvas.value.width = canvas.value.height = 0;
});
</script>
