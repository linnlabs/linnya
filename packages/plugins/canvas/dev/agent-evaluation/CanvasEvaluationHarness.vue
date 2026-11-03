<template>
  <section
    class="linnya-canvas canvas-evaluation-harness"
    aria-label="Canvas M4可信验收画布"
    @keydown="surface?.keydown($event)"
  >
    <div
      ref="stage"
      class="canvas-stage"
    />
    <div
      ref="editor"
      class="canvas-editor-overlay markdown-document-content"
      :style="surface?.editorStyle.value"
      @compositionstart="surface?.setComposing(true)"
      @compositionend="surface?.setComposing(false)"
      @pointerdown.stop
    />
    <div
      ref="staging"
      class="canvas-raster-staging"
      aria-hidden="true"
    />
    <CanvasAgentReviewBar
      v-if="review"
      :review="review"
      @locate="surface?.locate($event)"
    />
    <p
      class="canvas-status"
      role="status"
    >
      验收画布 · {{ documentId }} · {{ dirty ? '未保存草稿' : '已同步' }}
    </p>
    <p
      v-if="failure"
      class="canvas-status canvas-status-error"
      role="alert"
    >
      {{ failure }}
    </p>
  </section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { createEmbeddedMarkdownEditor } from '@plugin/renderer/embeddedMarkdownEditor';
import type { CanvasSynchronization } from '@plugin/canvas/shared';
import { createCanvasSurface } from '../../src/renderer/orchestration/createCanvasSurface';
import { createCanvasDocumentPort } from '../../src/renderer/adapters/createCanvasDocumentPort';
import { createCanvasArrangementPort } from '../../src/renderer/adapters/createCanvasArrangementPort';
import { createCanvasCardMediaPort } from '../../src/renderer/adapters/createCanvasCardMediaPort';
import { subscribeCanvasRestored } from '../../src/renderer/adapters/subscribeCanvasRestored';
import { createCanvasAgentReviewPort } from '../../src/renderer/adapters/createCanvasAgentReviewPort';
import { createCanvasCardContent, type CanvasCardContent } from '../../src/renderer/features/cardMedia';
import { CanvasAgentReviewBar, createCanvasAgentReview } from '../../src/renderer/features/agentReview';
const props = defineProps<{ projectId: string; documentId: string }>();
const emit = defineEmits<{ ready: [surface: Awaited<ReturnType<typeof createCanvasSurface>>]; synchronized: [update: CanvasSynchronization]; failure: [message: string] }>();
const stage = ref<HTMLElement | null>(null), editor = ref<HTMLElement | null>(null), staging = ref<HTMLElement | null>(null);
const surface = shallowRef<Awaited<ReturnType<typeof createCanvasSurface>> | null>(null), review = shallowRef<ReturnType<typeof createCanvasAgentReview> | null>(null);
const dirty = ref(false), failure = ref<string | null>(null); let content: CanvasCardContent | null = null, disposed = false;
onMounted(async () => {
  const host = stage.value, editorHost = editor.value, stagingHost = staging.value;
  if (!host || !editorHost || !stagingHost) return;
  try {
    const cards = createCanvasCardContent(props.documentId, createCanvasCardMediaPort(props.projectId)); content = cards;
    const document = createCanvasDocumentPort();
    const value = await createCanvasSurface({ host, editorHost, stagingHost, documentId: props.documentId }, {
      document: { ...document, async changes(documentId, afterSequence) { const update = await document.changes(documentId, afterSequence); if (!disposed) emit('synchronized', update); return update; } }, arrangement: createCanvasArrangementPort(), createEditor: createEmbeddedMarkdownEditor, subscribeRestored: subscribeCanvasRestored,
      createContent: cards.create, readContentKey: cards.contentKey, readDocumentTitles: cards.documentTitles, refreshVisibleContent: cards.refreshVisible, readThumbnailCards: cards.thumbnailCards,
      refreshReferences: cards.refreshReferences, subscribeContent: cards.subscribe, resolveImageSource: cards.resolveImageSource, retryContent: cards.retry, markDirty: value => { dirty.value = value; },
    });
    if (disposed) { value.destroy(); cards.dispose(); return; }
    surface.value = value; review.value = createCanvasAgentReview(value.session, createCanvasAgentReviewPort()); await review.value.refresh(); emit('ready', value);
  } catch (error) { failure.value = error instanceof Error ? error.message : String(error); emit('failure', failure.value); }
});
onBeforeUnmount(() => { disposed = true; review.value?.dispose(); surface.value?.destroy(); content?.dispose(); });
</script>
