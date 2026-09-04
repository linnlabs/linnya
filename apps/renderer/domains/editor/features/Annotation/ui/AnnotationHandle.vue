<!--
 * src/renderer/features/Annotation/ui/AnnotationHandle.vue
 * 作用: 批注手柄组件，根据批注状态动态显示不同的SVG图标。
-->
<template>
  <div
    class="annotation-handle"
    data-annotation-handle="true"
    @click="handleClick"
  >
    <component
      :is="currentIcon"
      class="annotation-icon"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';
import { AnnotationState } from '../commands/AnnoStateCommands';
import { AddCommentIcon } from '@linnya/renderer-ui/icons';
import { CommentIcon } from '@linnya/renderer-ui/icons';
import { SolvedCommentIcon } from '@linnya/renderer-ui/icons';

interface AnnotationHandleItem {
  readonly state?: string | null;
}

interface AnnotationStateContract {
  readonly RESOLVED: string;
}

const props = withDefaults(defineProps<{
  readonly annotations?: readonly AnnotationHandleItem[];
}>(), {
  annotations: () => [],
});

const emit = defineEmits<{
  'create-annotation': [event: MouseEvent];
}>();

// 尝试从父组件注入 AnnotationState
const injectedAnnotationState = inject<AnnotationStateContract | null>('AnnotationState', null);
const stateContract: AnnotationStateContract = injectedAnnotationState || AnnotationState;

const status = computed(() => {
  if (!props.annotations || props.annotations.length === 0) {
    return 'none'; // 没有批注
  }
  const allResolved = props.annotations.every(
    annotation => annotation.state === stateContract.RESOLVED
  );
  if (allResolved) {
    return 'resolved'; // 所有批注都已解决
  }
  return 'active'; // 有活动的或未解决的批注
});

const currentIcon = computed(() => {
  switch (status.value) {
    case 'none':
      return AddCommentIcon;
    case 'resolved':
      return SolvedCommentIcon;
    case 'active':
    default:
      return CommentIcon;
  }
});

const handleClick = (event: MouseEvent) => {
  // 总是触发创建新批注的事件，并传递原始事件对象
  emit('create-annotation', event);
};
</script> 
