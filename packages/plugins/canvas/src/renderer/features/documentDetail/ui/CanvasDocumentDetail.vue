<template>
  <section
    ref="overlay"
    class="canvas-document-detail"
    :class="{ 'canvas-document-detail-ready': detail?.state.ready.value }"
    :style="style"
    :aria-label="t('canvas.detail.label')"
    tabindex="0"
    @pointerdown.stop
    @mousedown="mousedown"
    @dblclick="open"
    @contextmenu.prevent.stop="context"
    @wheel.stop
    @keydown="keydown"
  >
    <div
      ref="body"
      class="canvas-document-detail-body"
      :class="{ 'canvas-document-detail-loading': !detail?.state.ready.value }"
      :style="bodyStyle"
    />
    <p v-if="detail?.state.notice.value" class="canvas-document-detail-notice" role="status">
      {{ detail.state.notice.value }}
    </p>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { CanvasCamera, CanvasRectangle } from '@plugin/canvas/shared';
import type {
  CanvasDocumentDetailCard,
  CanvasDocumentDetailPort,
} from '../definitions/documentDetail';
import { createCanvasDocumentDetail } from '../orchestration/createCanvasDocumentDetail';
import { installCanvasDocumentNavigation } from '../orchestration/installCanvasDocumentNavigation';
import { cardEditorStyle } from '../../cardEditing';
import { canvasText as t } from '../../localization';
import { readCanvasCardCssPalette } from '@plugin/canvas/shared';
import { RENDERER_UI_THEME_ATTRIBUTE } from '@linnya/renderer-ui/theme';

const props = defineProps<{
  card: CanvasDocumentDetailCard;
  camera: CanvasCamera;
  /** 改尺寸拖动到新尺寸落地前的外框；与其他卡片一样，正文保持旧排版、裁在新纸面内。 */
  frame?: CanvasRectangle | null;
  projectId: string;
  port: CanvasDocumentDetailPort;
}>();
const emit = defineEmits<{ close: [] }>();
const overlay = ref<HTMLElement | null>(null),
  body = ref<HTMLElement | null>(null),
  detail = shallowRef<ReturnType<typeof createCanvasDocumentDetail> | null>(null),
  dark = ref(false);
const style = computed(() => {
  const ink = readCanvasCardCssPalette(props.card.color, dark.value);
  return {
    ...cardEditorStyle(props.frame ?? props.card, props.camera),
    display: 'flex',
    color: ink.body,
    '--color-text-primary': ink.body,
    '--canvas-card-title-color': ink.title,
    '--canvas-card-muted-color': ink.muted,
    '--canvas-card-paper-color': ink.paper,
  };
});
// 正文按存储尺寸排版：拖动中不逐帧重排，落地后存储尺寸更新再按新宽度原地换成新排版。
const heldSize = shallowRef<{ readonly width: number; readonly height: number } | null>(null);
watch(
  () => props.frame,
  frame => {
    if (frame) heldSize.value ??= { width: props.card.width, height: props.card.height };
    // 卡宽没变就不会重排，没有新排版可等。
    else if (heldSize.value?.width === props.card.width) heldSize.value = null;
  },
  { immediate: true }
);
const bodyStyle = computed(() => {
  if (props.frame)
    return { flex: 'none', width: `${props.card.width}px`, height: `${props.card.height}px` };
  // 落地后宽度放开给重排量取，高度等新排版就绪再放开，旧排版不先露出原来裁掉的部分。
  return heldSize.value ? { flex: 'none', height: `${heldSize.value.height}px` } : undefined;
});
let stopNavigation: (() => void) | null = null,
  theme: MutationObserver | null = null;
const close = () => {
  emit('close');
  props.port.focus();
};
// 详情盖住了画布：右键和双击要和未选中的卡片一样，分别弹出卡片菜单、打开文档。
const fromControl = (event: Event) =>
  event.target instanceof Element && Boolean(event.target.closest('button,a'));
const mousedown = (event: MouseEvent) => {
  // 双击用来打开文档，不先选中一个词再跳走；拖选复制不受影响。
  if (event.detail > 1 && !fromControl(event)) event.preventDefault();
};
const open = (event: MouseEvent) => {
  if (fromControl(event)) return;
  event.preventDefault();
  void props.port.open(props.card);
};
const context = (event: MouseEvent) => {
  void props.port.context(props.card.id, { x: event.clientX, y: event.clientY });
};
const keydown = (event: KeyboardEvent) => {
  // 正文保留原生选字与只读导航，画布搜索/加入对话仍由页面同一快捷键入口处理。
  if (
    !event.isComposing &&
    (event.metaKey || event.ctrlKey) &&
    ['f', 'k'].includes(event.key.toLowerCase())
  )
    return;
  event.stopPropagation();
  if (!event.isComposing && event.key === 'Escape') {
    event.preventDefault();
    close();
  }
};
onMounted(() => {
  if (!body.value || !overlay.value) return;
  const root = overlay.value.ownerDocument.documentElement;
  const readTheme = () => {
    dark.value = root.getAttribute(RENDERER_UI_THEME_ATTRIBUTE) === 'dark';
  };
  readTheme();
  theme = new MutationObserver(readTheme);
  theme.observe(root, { attributes: true, attributeFilter: [RENDERER_UI_THEME_ATTRIBUTE] });
  stopNavigation = installCanvasDocumentNavigation(overlay.value, props.port.navigate);
  detail.value = createCanvasDocumentDetail({
    card: props.card,
    projectId: props.projectId,
    element: body.value,
    port: props.port,
    rendered: () => {
      if (!props.frame) heldSize.value = null;
    },
  });
  void detail.value.mount();
});
onBeforeUnmount(() => {
  theme?.disconnect();
  stopNavigation?.();
  detail.value?.dispose();
});
</script>
