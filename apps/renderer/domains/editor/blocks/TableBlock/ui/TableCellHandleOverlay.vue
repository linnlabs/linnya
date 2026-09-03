<!-- src/renderer/features/TableBlock/ui/TableCellHandleOverlay.vue -->
<!-- 表格单元格选中柄overlay组件 -->
<template>
  <Teleport to="body">
    <div
      v-if="showHandle && handlePosition"
      class="cell-handle-overlay"
      :class="{ 'hovering': isHovering }"
      :style="handleStyle"
      data-cell-handle="true"
      @mousedown="handleMouseDown"
      @mouseenter="onHandleHover"
      @mouseleave="onHandleLeave"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, type CSSProperties } from 'vue';
import type { Editor } from '@tiptap/core';
import { getCellBoundingRect } from '../position/tablePositionUtils';
import { useTableCellHandlePosition } from './composables/useTableCellHandlePosition';

interface Props {
  editor: Editor | null;
  activeCellPos: number | null;
  showHandle: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  mousedown: [MouseEvent];
}>();

const handleMouseDown = (event: MouseEvent) => {
  emit('mousedown', event);
};

const isHovering = ref(false);
const editorRoot = computed<HTMLElement | null>(() => props.editor?.view.dom ?? null);
const showHandle = computed(() => props.showHandle);
const activeCellPos = computed(() => props.activeCellPos);
const handlePosition = useTableCellHandlePosition({
  showHandle,
  activeCellPos,
  editorRoot,
  getCellRect: (posInsideCell) => {
    return props.editor ? getCellBoundingRect(props.editor, posInsideCell) : null;
  },
});

// 计算样式
const handleStyle = computed(() => {
  if (!handlePosition.value) return {};
  
  const { left, top } = handlePosition.value;
  
  const style: CSSProperties = {
    transform: `translate3d(${left}px, ${top}px, 0)`,
  };
  return style;
});

// 处理悬停状态
const onHandleHover = () => {
  isHovering.value = true;
};

const onHandleLeave = () => {
  isHovering.value = false;
};
</script>
