<!-- TableSizeSelector.vue -->
<!-- 表格尺寸选择器：仿 Word 风格的网格交互式表格尺寸选择器 -->

<template>
  <div 
    class="table-size-selector" 
    ref="containerRef"
    @mousedown.stop
    @click.stop
    tabindex="0"
    @keydown="handleKeyDown"
  >
    <!-- 网格区域 -->
    <div class="grid-container">
      <div 
        v-for="row in maxRows" 
        :key="`row-${row}`" 
        class="grid-row"
      >
        <div
          v-for="col in maxCols"
          :key="`cell-${row}-${col}`"
          class="grid-cell"
          :class="{ 
            'is-selected': row <= hoveredRows && col <= hoveredCols,
            'is-header': withHeaderRow && row === 1 && col <= hoveredCols
          }"
          @mouseenter="handleCellHover(row, col)"
          @click="handleCellClick"
        ></div>
      </div>
    </div>

    <!-- 尺寸显示与表头行选项 -->
    <div class="selector-footer">
      <div class="size-display">
        {{ formatTableBlockSizeDisplay(hoveredRows, hoveredCols, editorMessage) }}
      </div>
      <div class="header-row-option">
        <CustomCheckbox v-model="withHeaderRow">
          {{ editorMessage('editor.tableBlock.size.headerRow') }}
        </CustomCheckbox>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { CustomCheckbox } from '@linnya/renderer-ui';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';
import { formatTableBlockSizeDisplay } from '../functions/tableBlockPresentation';

const props = defineProps({
  // 最大行数
  maxRows: {
    type: Number,
    default: 10
  },
  // 最大列数
  maxCols: {
    type: Number,
    default: 8
  },
  // 默认选中的行数
  defaultRows: {
    type: Number,
    default: 3
  },
  // 默认选中的列数
  defaultCols: {
    type: Number,
    default: 3
  },
  // 默认是否包含表头行
  defaultWithHeader: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(['confirm', 'cancel']);
const { editorMessage } = useEditorLocalization();

// 容器引用
const containerRef = ref(null);

// 当前悬停/选中的行列数
const hoveredRows = ref(props.defaultRows);
const hoveredCols = ref(props.defaultCols);

// 是否包含表头行
const withHeaderRow = ref(props.defaultWithHeader);

// 处理单元格悬停
const handleCellHover = (row, col) => {
  hoveredRows.value = row;
  hoveredCols.value = col;
};

// 处理单元格点击（确认选择）
const handleCellClick = () => {
  confirmSelection();
};

// 确认选择
const confirmSelection = () => {
  emit('confirm', {
    rows: hoveredRows.value,
    cols: hoveredCols.value,
    withHeaderRow: withHeaderRow.value
  });
};

// 取消选择
const cancel = () => {
  emit('cancel');
};

// 键盘导航
const handleKeyDown = (event) => {
  const { key } = event;
  
  // 方向键导航
  if (key === 'ArrowUp') {
    event.preventDefault();
    event.stopPropagation();
    hoveredRows.value = Math.max(1, hoveredRows.value - 1);
  } else if (key === 'ArrowDown') {
    event.preventDefault();
    event.stopPropagation();
    hoveredRows.value = Math.min(props.maxRows, hoveredRows.value + 1);
  } else if (key === 'ArrowLeft') {
    event.preventDefault();
    event.stopPropagation();
    hoveredCols.value = Math.max(1, hoveredCols.value - 1);
  } else if (key === 'ArrowRight') {
    event.preventDefault();
    event.stopPropagation();
    hoveredCols.value = Math.min(props.maxCols, hoveredCols.value + 1);
  } 
  // Enter 确认
  else if (key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    confirmSelection();
  } 
  // Escape 取消
  else if (key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }
  // Tab 键切换焦点到复选框（允许默认行为）
};

// 点击外部关闭
const handleClickOutside = (event) => {
  if (containerRef.value && !containerRef.value.contains(event.target)) {
    cancel();
  }
};

onMounted(() => {
  // 延迟添加监听器，避免当前点击事件触发关闭
  setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
  }, 150);
  
  // 自动聚焦到容器，启用键盘导航
  nextTick(() => {
    containerRef.value?.focus();
  });
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>
