<template>
  <PresentationReadonlyPreview
    :read="read"
    :labels="labels"
    autofocus
  />
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useLocalization } from '@app/localization';
import { SlidesHistoryPreviewSchema, parseSlidesCommand } from '@plugin/slides/shared/ipcCommands';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { SLIDES_IPC, SLIDES_PLUGIN_ID } from '@plugin/slides/shared/ipc';
import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';
import { PresentationReadonlyPreview } from '../../presentationPreview';
import { SLIDES_HISTORY_FALLBACKS } from '../definitions/historyMessages';
const props = defineProps<{ documentId: string; versionId: string }>();
const localization = useLocalization();
const message = (key: keyof typeof SLIDES_HISTORY_FALLBACKS) =>
  localization.message(key, SLIDES_HISTORY_FALLBACKS[key]);
const labels = computed(() => ({
  readonly: message('slides.history.readonly'),
  loading: message('slides.history.loading'),
  failed: message('slides.history.failed'),
  empty: message('slides.history.empty'),
  pages: message('slides.history.pages'),
  previous: message('slides.history.previous'),
  next: message('slides.history.next'),
}));
async function read(): Promise<PresentationRenderModel> {
  const response = await invokeRendererPluginIpc<PresentationRenderModel>(
    SLIDES_PLUGIN_ID,
    SLIDES_IPC.historyPreview,
    parseSlidesCommand(SlidesHistoryPreviewSchema, {
      documentId: props.documentId,
      versionId: props.versionId,
    })
  );
  if (!response.success) throw new Error(response.error);
  return response.data;
}
</script>
