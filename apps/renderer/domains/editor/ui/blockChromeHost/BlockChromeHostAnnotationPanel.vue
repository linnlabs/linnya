<template>
  <Teleport v-if="isMounted && panelPresence.hasPanels" to=".annotation-layer">
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

import { inject, onMounted, ref, type Ref } from 'vue';
import AnnotationPanel from '../../features/Annotation/ui/AnnotationPanel.vue';
import { ANNOTATION_RUNTIME_STORE_KEY } from '../../features/Annotation/definitions/injectionKeys';
import {
  useAnnotationPanelPresence,
  type AnnotationRuntimeStoreLike,
} from '../../features/Annotation/readModel';

const emptyAnnotationStore = ref<AnnotationRuntimeStoreLike | null>(null);
const annotationStore = inject<Ref<AnnotationRuntimeStoreLike | null | undefined>>(
  ANNOTATION_RUNTIME_STORE_KEY,
  emptyAnnotationStore
);

const isMounted = ref(false);
const panelPresence = useAnnotationPanelPresence(annotationStore);

onMounted(() => {
  // 中文说明：annotation-layer 由 AppLayout 提供，等当前组件 mounted 后再 Teleport，避免目标节点尚未就绪。
  isMounted.value = true;
});
</script>
