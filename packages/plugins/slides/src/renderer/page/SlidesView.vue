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

/** 上一次加载 renderModel 时对应的 deckId，用于区分"首次加载"和"刷新" */
let lastRenderDeckId: string | null = null;

/**
 * 标记当前 deck 的 deckPreview 首次到达是否还未被消费。
 * 用于避免 deckPreview 首次到达时重复触发 loadRenderModel
 * （因为 currentDeckId watch 已经提前启动了）。
 */
let pendingInitialPreview = false;

/** deck 切换只重置会话/UI；是否允许请求 renderModel 由 build-state 决定。 */
watch(currentDeckId, () => {
  slidesUiStore.$reset();
  slidesSessionStore.$reset();
  presentationExportStore.$reset();
  lastRenderDeckId = null;
  pendingInitialPreview = false;
  slidesRenderStore.clearRenderModel();
}, { immediate: true });

/** draft 是不可渲染的正式状态，禁止偷偷回退到空白基线或旧物化。 */
watch(documentBuildState, (buildState) => {
  const nodeId = currentDeckId.value;
  if (
    !nodeId ||
    buildState?.state !== 'ready' ||
    buildState.presentationId !== nodeId
  ) {
    lastRenderDeckId = null;
    pendingInitialPreview = false;
    slidesRenderStore.clearRenderModel();
    return;
  }

  // 同一 deck 已有可见物化时，新的 ready 只是版本刷新。
  // 等 deckPreview 到达后走 keepExisting 分支，避免把热更新误判成首次加载而清空画布。
  if (lastRenderDeckId === nodeId && slidesRenderStore.renderModel !== null) {
    return;
  }

  lastRenderDeckId = nodeId;
  pendingInitialPreview = true;
  slidesRenderStore.loadRenderModel(nodeId, { keepExisting: false });
}, { immediate: true });

/*
 * deckPreview 变化 → 仅在「同 deck 刷新」时静默重加载 renderModel。
 * 首次到达（pendingInitialPreview=true）直接消费标记，不重复请求。
 */
watch(deckPreview, () => {
  const nodeId = currentDeckId.value;
  if (!nodeId || !deckPreview.value) return;

  if (pendingInitialPreview) {
    pendingInitialPreview = false;
    return;
  }

  // 同一 deck 的后续 deckPreview 更新（如工具刷新）→ 保留旧渲染，静默重加载
  if (nodeId === lastRenderDeckId) {
    slidesRenderStore.loadRenderModel(nodeId, { keepExisting: true });
  }
});
</script>
