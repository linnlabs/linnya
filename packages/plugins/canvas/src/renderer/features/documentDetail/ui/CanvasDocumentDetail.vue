<template>
  <section
    ref="overlay"
    class="canvas-document-detail"
    :style="style"
    aria-label="所选文档只读详情"
    tabindex="0"
    @pointerdown.stop
    @wheel.stop
    @keydown.stop
    @keydown.esc.prevent="close"
  >
    <header
      class="canvas-document-detail-header"
      @dblclick.stop="open"
    >
      <strong>{{ title }}</strong>
      <button
        type="button"
        @click="open"
      >
        打开文档
      </button>
      <button
        type="button"
        aria-label="关闭文档详情并回到画布"
        @click="close"
      >
        关闭
      </button>
    </header>
    <div
      ref="body"
      class="canvas-document-detail-body"
      :class="{ 'canvas-document-detail-loading': !detail?.state.ready.value }"
    />
    <p
      v-if="detail?.state.notice.value"
      class="canvas-document-detail-notice"
      role="status"
    >
      {{ detail.state.notice.value }}
    </p>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import type { CanvasCamera } from '@plugin/canvas/shared';
import type { CanvasDocumentDetailCard, CanvasDocumentDetailPort } from '../definitions/documentDetail';
import { createCanvasDocumentDetail } from '../orchestration/createCanvasDocumentDetail';
import { installCanvasDocumentNavigation } from '../orchestration/installCanvasDocumentNavigation';
import { cardEditorStyle } from '../../cardEditing';
import { readCanvasCardCssPalette } from '@plugin/canvas/shared';
import { RENDERER_UI_THEME_ATTRIBUTE } from '@linnya/renderer-ui/theme';

const props = defineProps<{ card: CanvasDocumentDetailCard; camera: CanvasCamera; projectId: string; title: string; port: CanvasDocumentDetailPort }>();
const emit = defineEmits<{ close: [] }>();
const overlay = ref<HTMLElement | null>(null), body = ref<HTMLElement | null>(null), detail = shallowRef<ReturnType<typeof createCanvasDocumentDetail> | null>(null), dark = ref(false);
const style = computed(() => { const ink = readCanvasCardCssPalette(props.card.color, dark.value); return { ...cardEditorStyle(props.card, props.camera), display: 'flex', '--color-text-primary': ink.body, '--canvas-card-paper-color': ink.paper }; });
let stopNavigation: (() => void) | null = null, theme: MutationObserver | null = null;
const close = () => { emit('close'); props.port.focus(); };
const open = async () => { await props.port.open(props.card); };
onMounted(() => {
  if (!body.value || !overlay.value) return;
  const root = overlay.value.ownerDocument.documentElement;
  const readTheme = () => { dark.value = root.getAttribute(RENDERER_UI_THEME_ATTRIBUTE) === 'dark'; }; readTheme();
  theme = new MutationObserver(readTheme); theme.observe(root, { attributes: true, attributeFilter: [RENDERER_UI_THEME_ATTRIBUTE] });
  stopNavigation = installCanvasDocumentNavigation(overlay.value, props.port.navigate);
  detail.value = createCanvasDocumentDetail({ card: props.card, projectId: props.projectId, element: body.value, port: props.port }); void detail.value.mount();
});
onBeforeUnmount(() => { theme?.disconnect(); stopNavigation?.(); detail.value?.dispose(); });
</script>
