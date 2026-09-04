<template>
  <Teleport
    v-if="isMounted && panelPresence.hasPanels && panelMountElement"
    :to="panelMountElement"
  >
    <AnnotationPanel />
  </Teleport>
</template>

<script setup lang="ts">
/**
 * Host 版批注面板挂载层。
 *
 * 中文说明：
 * - Host 只接管“批注面板应该挂到 annotation-layer”这个 surface 归属；
 * - 面板内部的编辑、删除、AI 动作、布局避让和持久化仍全部留在 Annotation feature；
 * - 没有批注时不常驻挂载 AnnotationPanel，减少空面板的全局监听和响应式订阅。
 */

import { computed, inject, nextTick, onMounted, ref, watch, type Ref } from 'vue';
import AnnotationPanel from '../../features/Annotation/ui/AnnotationPanel.vue';
import {
  ANNOTATION_PANEL_POSITION_MANAGER_KEY,
  ANNOTATION_RUNTIME_STORE_KEY,
} from '../../features/Annotation/definitions/injectionKeys';
import {
  useAnnotationPanelPresence,
  type AnnotationRuntimeStoreLike,
} from '../../features/Annotation/readModel';

const emptyAnnotationStore = ref<AnnotationRuntimeStoreLike | null>(null);
const annotationStore = inject<Ref<AnnotationRuntimeStoreLike | null | undefined>>(
  ANNOTATION_RUNTIME_STORE_KEY,
  emptyAnnotationStore
);
const panelPositionManager = inject(ANNOTATION_PANEL_POSITION_MANAGER_KEY, ref(null));

const isMounted = ref(false);
const panelPresence = useAnnotationPanelPresence(annotationStore);
const panelMountElement = computed(() => {
  // 让首批持久化批注和稍后创建的 draft 都会在 panel 数量变化时重新解析 DOM target。
  void panelPresence.value.panelCount;
  return panelPositionManager.value?.getPanelMountElement?.() ?? null;
});

onMounted(() => {
  // 中文说明：annotation-layer 由当前 Markdown Document Surface 提供，等组件 mounted 后再 Teleport。
  isMounted.value = true;
});

watch(
  [isMounted, () => panelPresence.value.panelCount, panelMountElement],
  async ([mounted, panelCount, mountElement]) => {
    if (!mounted || panelCount === 0 || !mountElement) return;

    // Teleport 的面板 DOM 在下一轮更新后才进入 owner layer；此时做一次全量布局，
    // 可覆盖首屏恢复持久化批注和稍后创建首个 draft 两种挂载时序。
    await nextTick();
    await panelPositionManager.value?.recalculateAllPositions?.(true);
  },
  { flush: 'post' }
);
</script>
