<template>
  <PresentationReadonlyPreview
    :key="`${projectId}:${documentId}:${revision}`"
    :read="read"
    :labels="labels"
  />
</template>
<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { subscribeWorkspaceMutations } from '@plugin/renderer/workspaceRuntime';
import { useLocalization } from '@app/localization';
import { SlidesNodePayloadSchema, parseSlidesCommand } from '@plugin/slides/shared/ipcCommands';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { readDocumentReference } from '@plugin/renderer/documentReferences';
import { SLIDES_IPC, SLIDES_PLUGIN_ID } from '@plugin/slides/shared/ipc';
import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';
import { SLIDES_PREVIEW_FALLBACKS } from '../definitions/previewMessages';
import PresentationReadonlyPreview from './PresentationReadonlyPreview.vue';
const props = defineProps<{ documentId: string; projectId: string }>();
const revision = ref(0);
let unsubscribe: (() => void) | undefined;
onMounted(() => {
  unsubscribe = subscribeWorkspaceMutations(event => {
    const affectsDocument =
      event.type === 'workspace.document.updated'
        ? event.documentId === props.documentId
        : event.type === 'workspace.node.deleted'
          ? event.deletedNodeIds.includes(props.documentId)
          : event.type === 'workspace.node.transferred'
            ? event.movedNodeIds.includes(props.documentId)
            : event.type === 'project.deleted' && event.projectId === props.projectId;
    if (affectsDocument) revision.value++;
  });
});
onBeforeUnmount(() => unsubscribe?.());
const localization = useLocalization();
const message = (key: keyof typeof SLIDES_PREVIEW_FALLBACKS) =>
  localization.message(key, SLIDES_PREVIEW_FALLBACKS[key]);
const labels = computed(() => ({
  readonly: message('slides.preview.readonly'),
  loading: message('slides.preview.loading'),
  failed: message('slides.preview.failed'),
  empty: message('slides.preview.empty'),
  pages: message('slides.preview.pages'),
  previous: message('slides.preview.previous'),
  next: message('slides.preview.next'),
}));
async function assertAvailable(): Promise<void> {
  const current = await readDocumentReference({
    documentId: props.documentId,
    projectId: props.projectId,
  });
  if (current.status !== 'available')
    throw new Error('Preview document is not available in this project');
}
async function read(): Promise<PresentationRenderModel> {
  await assertAvailable();
  const response = await invokeRendererPluginIpc<PresentationRenderModel>(
    SLIDES_PLUGIN_ID,
    SLIDES_IPC.renderModel,
    parseSlidesCommand(SlidesNodePayloadSchema, { nodeId: props.documentId })
  );
  if (!response.success) throw new Error(response.error);
  // 私有IPC读取期间目标可能跨项目移动；不可把此前合法的异步正文交给新范围。
  await assertAvailable();
  return response.data;
}
</script>
