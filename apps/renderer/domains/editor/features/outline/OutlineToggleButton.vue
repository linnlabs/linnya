<template>
  <span
    ref="hostAnchorRef"
    class="outline-geometry-anchor"
    aria-hidden="true"
  />
  <Teleport to="body">
    <button
      v-show="outlineHasHeadings && outlineHostGeometryReady"
      class="outline-toggle-button"
      type="button"
      :aria-expanded="isOutlineExpanded"
      :aria-label="outlineHandleLabel"
      :style="toggleStyle"
      :class="{
        'fade-in': outlineReady,
        'is-previewed': isOutlineExpanded,
        'is-active': uiStore.outlineVisible,
        'is-pinned': uiStore.outlineVisible,
      }"
      @mouseenter="handleTriggerMouseEnter"
      @mouseleave="scheduleTriggerMouseLeave"
      @focus="setHandleFocused(true)"
      @blur="setHandleFocused(false)"
      @click="handleTriggerClick"
    >
      <span
        class="outline-rail-trigger__thumb"
        aria-hidden="true"
      />
    </button>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useUIStore } from '../../../../shared/stores/ui';
import { useOutlineRuntimeState } from './store/useOutlineRuntimeState';
import { calculateOutlineTriggerTop } from './functions/outlineFloatingGeometry';
import { useEditorLocalization } from '../../ui/useEditorLocalization';

const uiStore = useUIStore();
const { editorMessage } = useEditorLocalization();
const {
  hasHeadings: outlineHasHeadings,
  outlineReady,
  outlinePreviewVisible,
  outlineHostLeft,
  outlineHostTop,
  outlineHostHeight,
  outlineHostGeometryReady,
  setHandleHovered,
  setHandleFocused,
  setHostGeometry,
  resetHostGeometry,
} = useOutlineRuntimeState();

const OUTLINE_TRIGGER_HEIGHT = 104;
const OUTLINE_FLOATING_EDGE_GAP = 16;

const hostAnchorRef = ref(null);
const isOutlineExpanded = computed(() => uiStore.outlineVisible || outlinePreviewVisible.value);
let hostResizeObserver = null;
let geometryRafId = 0;
let triggerLeaveTimeoutId = 0;

const toggleStyle = computed(() => ({
  left: `${outlineHostLeft.value}px`,
  top: `${calculateOutlineTriggerTop({
    hostTop: outlineHostTop.value,
    hostHeight: outlineHostHeight.value,
    viewportHeight: globalThis.innerHeight,
    edgeGap: OUTLINE_FLOATING_EDGE_GAP,
    triggerHeight: OUTLINE_TRIGGER_HEIGHT,
  })}px`,
}));

const outlineHandleLabel = computed(() => (
  uiStore.outlineVisible
    ? editorMessage('editor.outline.togglePinned')
    : editorMessage('editor.outline.togglePreview')
));

const resolveOutlineHostElement = () => {
  const anchor = hostAnchorRef.value;
  if (!anchor) return null;

  // 中文说明：这里的“窗口”指当前文档 pane，不是整个 Electron app。
  // 目录视觉层 Teleport 到 body 以避开 transform/fixed 的浏览器定位陷阱，
  // 但坐标必须回读当前文件窗口的左边界。
  return (
    anchor.closest('.document-pane__body') ||
    anchor.closest('.document-pane') ||
    anchor.parentElement
  );
};

const clearTriggerLeaveTimeout = () => {
  if (triggerLeaveTimeoutId === 0) return;
  globalThis.clearTimeout(triggerLeaveTimeoutId);
  triggerLeaveTimeoutId = 0;
};

const handleTriggerMouseEnter = () => {
  clearTriggerLeaveTimeout();
  setHandleHovered(true);
};

const scheduleTriggerMouseLeave = () => {
  clearTriggerLeaveTimeout();
  // 中文说明：给鼠标从竖条移动到目录面板留一点时间，避免预览层在边界处闪关。
  triggerLeaveTimeoutId = globalThis.setTimeout(() => {
    triggerLeaveTimeoutId = 0;
    setHandleHovered(false);
  }, 140);
};

const handleTriggerClick = () => {
  const wasPinned = uiStore.outlineVisible;
  uiStore.toggleOutline();

  if (wasPinned) {
    // 中文说明：点击取消固定后按钮仍会保持 DOM focus。
    // 这里必须清掉 focus 驱动的预览态，只保留真实 hover；
    // 否则鼠标离开竖条后 outlinePreviewVisible 仍会被 focus 撑住。
    setHandleFocused(false);
  }
};

const updateHostGeometry = () => {
  if (geometryRafId !== 0) {
    globalThis.cancelAnimationFrame(geometryRafId);
  }

  geometryRafId = globalThis.requestAnimationFrame(() => {
    geometryRafId = 0;
    const hostElement = resolveOutlineHostElement();
    if (!hostElement) {
      resetHostGeometry();
      return;
    }

    const rect = hostElement.getBoundingClientRect();
    setHostGeometry({
      left: Math.max(0, Math.round(rect.left)),
      top: Math.max(0, Math.round(rect.top)),
      height: Math.max(0, Math.round(rect.height)),
    });
  });
};

onMounted(async () => {
  await nextTick();
  updateHostGeometry();

  const hostElement = resolveOutlineHostElement();
  if (hostElement && typeof globalThis.ResizeObserver !== 'undefined') {
    hostResizeObserver = new globalThis.ResizeObserver(updateHostGeometry);
    hostResizeObserver.observe(hostElement);
  }

  globalThis.addEventListener('resize', updateHostGeometry);
  globalThis.addEventListener('pointerup', updateHostGeometry);
  globalThis.document?.addEventListener('transitionend', updateHostGeometry, true);
});

onBeforeUnmount(() => {
  clearTriggerLeaveTimeout();
  if (geometryRafId !== 0) {
    globalThis.cancelAnimationFrame(geometryRafId);
    geometryRafId = 0;
  }
  hostResizeObserver?.disconnect();
  globalThis.removeEventListener('resize', updateHostGeometry);
  globalThis.removeEventListener('pointerup', updateHostGeometry);
  globalThis.document?.removeEventListener('transitionend', updateHostGeometry, true);
  setHandleHovered(false);
  setHandleFocused(false);
  resetHostGeometry();
});

</script>
