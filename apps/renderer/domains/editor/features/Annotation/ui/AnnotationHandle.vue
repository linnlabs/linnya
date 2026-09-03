<!--
 * src/renderer/features/Annotation/ui/AnnotationHandle.vue
 * 作用: 批注手柄组件，根据批注状态动态显示不同的SVG图标。
-->
<template>
  <div
    class="annotation-handle"
    @click="handleClick"
    data-annotation-handle="true"
  >
    <component :is="currentIcon" class="annotation-icon" />
  </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import { AnnotationState } from '../commands/AnnoStateCommands';
import { AddCommentIcon } from '@linnya/renderer-ui/icons';
import { CommentIcon } from '@linnya/renderer-ui/icons';
import { SolvedCommentIcon } from '@linnya/renderer-ui/icons';

const props = defineProps({
  annotations: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['create-annotation']);

// 尝试从父组件注入 AnnotationState
const InjectedAnnotationState = inject('AnnotationState', null);
const
 
State = InjectedAnnotationState || AnnotationState;

const status = computed(() => {
  if (!props.annotations || props.annotations.length === 0) {
    return 'none'; // 没有批注
  }
  const allResolved = props.annotations.every(
    anno => anno.state === State.RESOLVED
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

const handleClick = (event) => {
  // 总是触发创建新批注的事件，并传递原始事件对象
  emit('create-annotation', event);
};
</script> 