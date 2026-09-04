<template>
  <AnnotationHandle
    :annotations="annotationSummary.annotations"
    @create-annotation="handleCreateAnnotation"
  />
</template>

<script setup lang="ts">
/**
 * Host 版批注入口。
 *
 * 中文说明：
 * - 这里只迁移右侧批注按钮这一层轻 UI；
 * - 创建批注仍走 EditorContext 提供的 Annotation 编排；
 * - 批注面板、重叠避让、持久化不进入 BlockChromeHost，避免 Host 变重。
 */

import { computed, inject, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import AnnotationHandle from '../../features/Annotation/ui/AnnotationHandle.vue';
import highlightState from '../../features/Annotation/AnnoHighlightState';
import {
  ANNOTATION_RUNTIME_STORE_KEY,
  TRIGGER_ANNOTATION_CREATE_KEY,
} from '../../features/Annotation/definitions/injectionKeys';
import {
  publishAnnotationInteractionPerf,
  readAnnotationPerfNowMs,
} from '../../features/Annotation/debug/annotationInteractionPerf';
import {
  useAnnotationHandleSummary,
  type AnnotationRuntimeStoreLike,
} from '../../features/Annotation/readModel';

const props = defineProps<{
  blockId: string;
  rootBlockOuterElement: HTMLElement | null;
}>();

const emptyAnnotationStore = ref<AnnotationRuntimeStoreLike | null>(null);
const annotationStore = inject<Ref<AnnotationRuntimeStoreLike | null | undefined>>(
  ANNOTATION_RUNTIME_STORE_KEY,
  emptyAnnotationStore
);
const triggerAnnotationCreate = inject(TRIGGER_ANNOTATION_CREATE_KEY, null);

const currentBlockId = computed(() => props.blockId);
const annotationSummary = useAnnotationHandleSummary(currentBlockId, annotationStore);

watch(
  () => annotationSummary.value.hasAnnotations,
  (hasAnnotations) => {
    const rootBlockOuterElement = props.rootBlockOuterElement;
    if (!rootBlockOuterElement) return;

    if (hasAnnotations) {
      rootBlockOuterElement.setAttribute('data-has-annotations', 'true');
    } else {
      rootBlockOuterElement.removeAttribute('data-has-annotations');
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  props.rootBlockOuterElement?.removeAttribute('data-has-annotations');
});

async function handleCreateAnnotation(event: MouseEvent): Promise<void> {
  const startedAt = readAnnotationPerfNowMs();
  event.preventDefault();
  event.stopPropagation();

  if (annotationSummary.value.hasAnnotations) {
    publishAnnotationInteractionPerf({
      kind: 'annotation-click',
      blockId: props.blockId,
      hadExistingAnnotations: true,
      totalMs: Math.round((readAnnotationPerfNowMs() - startedAt) * 10) / 10,
    });
    return;
  }

  if (!triggerAnnotationCreate) {
    console.error('[BlockChromeHostAnnotationHandle] triggerAnnotationCreate 未注入，无法创建批注。');
    return;
  }

  try {
    const triggerStartedAt = readAnnotationPerfNowMs();
    const annotationId = await triggerAnnotationCreate(props.blockId);
    if (!annotationId) return;
    highlightState.highlightBlock(props.blockId);
    publishAnnotationInteractionPerf({
      kind: 'annotation-click',
      blockId: props.blockId,
      hadExistingAnnotations: false,
      triggerMs: Math.round((readAnnotationPerfNowMs() - triggerStartedAt) * 10) / 10,
      totalMs: Math.round((readAnnotationPerfNowMs() - startedAt) * 10) / 10,
    });
  } catch (error) {
    console.error('[BlockChromeHostAnnotationHandle] 创建批注失败:', error);
  }
}
</script>
