<template>
  <section
    class="canvas-history-preview"
    aria-label="画布历史只读预览"
  >
    <div
      ref="host"
      class="canvas-stage"
    />
    <div
      ref="staging"
      class="canvas-raster-staging"
      aria-hidden="true"
    />
    <button
      type="button"
      class="canvas-history-fit"
      @click="preview?.fit()"
    >
      适合全部
    </button>
    <p
      v-if="preview?.state.phase.value === 'loading'"
      class="canvas-status"
      role="status"
    >
      正在读取历史…
    </p>
    <p
      v-if="preview?.state.error.value"
      class="canvas-status canvas-status-error"
      role="alert"
    >
      {{ preview.state.error.value }}
    </p>
  </section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { CANVAS_PLUGIN_ID, CanvasSnapshotSchema } from '@plugin/canvas/shared';
import { createCanvasRasterPresentation } from '../orchestration/createCanvasRasterPresentation';
import { createCanvasCardContent } from '../features/cardMedia';
import { createCanvasCardMediaPort } from '../adapters/createCanvasCardMediaPort';
import { createCanvasHistoryPreview } from '../features/historyPreview';
const props = defineProps<{ documentId: string; versionId: string }>();
const host = ref<HTMLElement | null>(null), staging = ref<HTMLElement | null>(null);
const preview = shallowRef<ReturnType<typeof createCanvasHistoryPreview> | null>(null);
onMounted(() => {
  const stage = host.value, stagingHost = staging.value;
  if (!stage || !stagingHost) return;
  preview.value = createCanvasHistoryPreview({ host: stage, createContent: documentId => createCanvasCardContent(documentId, createCanvasCardMediaPort()), createRaster: settings => createCanvasRasterPresentation({ ...settings, host: stagingHost }),
    read: async (documentId, versionId) => { const result = await invokeRendererPluginIpc<unknown>(CANVAS_PLUGIN_ID, 'canvas:history-preview', { documentId, versionId }); if (!result.success) throw new Error(result.error); return CanvasSnapshotSchema.parse(result.data); },
  });
  void preview.value.open(props.documentId, props.versionId);
});
watch([() => props.documentId, () => props.versionId], ([documentId, versionId]) => { void preview.value?.open(documentId, versionId); });
onBeforeUnmount(() => { preview.value?.dispose(); });
</script>
