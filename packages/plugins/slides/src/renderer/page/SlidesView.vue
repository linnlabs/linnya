<template>
  <div class="slides-view">
    <SlidesStatusState
      v-if="!hasOpenDeck"
      title="未打开演示文稿"
      description="请从左侧文件树或最近访问中打开一个演示文稿。"
    />
    <DeckViewer
      v-else
      :source-edit-busy="sourceEditBusy"
      @source-edit-submit="emit('sourceEditSubmit', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import { storeToRefs } from 'pinia';
import DeckViewer from '../ui/deck/DeckViewer.vue';
import SlidesStatusState from '../ui/shared/SlidesStatusState.vue';
import { useSlidesRenderStore } from '../store/slidesRenderStore';
import { useSlidesSessionStore } from '../store/slidesSessionStore';
import { useSlidesStore } from '../store/slidesStore';
import { useSlidesUiStore } from '../store/slidesUiStore';
import type { SourceSelectionEditSubmitPayload } from '../features/sourceSelection';
import { usePresentationExportStore } from '../features/presentationExport';
import {
  manualEditPresentationTrace,
  useManualEditQueue,
  provideManualEditSubmission,
  useManualEditingLocalization,
} from '../features/manualEditing';
import { useSlidesEditingInteractionStore } from '../features/editingInteraction';
import { refreshSlidesDocumentPresentation } from './orchestration/refreshSlidesDocumentPresentation';
import { useSlidesDocumentSave } from './orchestration/useSlidesDocumentSave';
import { slidesApi } from '../services/slidesApi';

defineProps<{
  sourceEditBusy?: boolean;
}>();

const emit = defineEmits<{
  sourceEditSubmit: [payload: SourceSelectionEditSubmitPayload];
}>();

const slidesStore = useSlidesStore();
const slidesRenderStore = useSlidesRenderStore();
const {
  currentDeckId,
  hasOpenDeck,
  deckPreview,
  documentBuildState,
} = storeToRefs(slidesStore);
const slidesUiStore = useSlidesUiStore();
const slidesSessionStore = useSlidesSessionStore();
const presentationExportStore = usePresentationExportStore();
const editingInteractionStore = useSlidesEditingInteractionStore();
const { manualEditingMessage } = useManualEditingLocalization();

const manualEditSubmission = useManualEditQueue({
  readSnapshot: () => ({ documentId: currentDeckId.value, buildState: documentBuildState.value,
    renderVersion: slidesRenderStore.renderModel?.version ?? null,
    presentationError: slidesRenderStore.renderError }),
  createCommandId: () => crypto.randomUUID(),
  submit: command => slidesApi.submitManualEdit(command),
  refreshDocument: refreshSlidesDocumentPresentation,
  message: manualEditingMessage,
  trace: manualEditPresentationTrace,
});
provideManualEditSubmission(manualEditSubmission);
useSlidesDocumentSave(manualEditSubmission);

/** 文档身份重置交互；渲染刷新只由正式 revision 驱动，与页面挂载先后无关。 */
watch(currentDeckId, () => {
  slidesUiStore.$reset();
  slidesSessionStore.$reset();
  presentationExportStore.$reset();
  editingInteractionStore.$reset();
  manualEditPresentationTrace.clear();
  slidesRenderStore.clearRenderModel();
}, { immediate: true });

let requestedRevision: string | null = null;
watch([currentDeckId, documentBuildState, deckPreview], ([nodeId, buildState]) => {
  if (!nodeId || buildState?.state !== 'ready' || buildState.presentationId !== nodeId) {
    requestedRevision = null;
    slidesRenderStore.clearRenderModel();
    return;
  }
  const revision = `${nodeId}:${buildState.versionId}`;
  if (requestedRevision === revision && slidesRenderStore.renderError === null) return;
  requestedRevision = revision;
  // ready 说明对应 DeckSpec 已落盘，不必再等待另一个 preview 事件。
  // 首次 preview 若在挂载前到达，也不能吞掉后续第一次保存的刷新。
  void slidesRenderStore.loadRenderModel(nodeId, {
    keepExisting: slidesRenderStore.renderModel?.presentationId === nodeId,
  });
}, { immediate: true });
</script>
