<!-- apps/renderer/features/TableBlock/ui/TableAiContext.vue -->
<!-- 表格AI上下文组件 - 显示引用列、选区范围、输出列等信息 -->
<template>
  <div class="table-ai-context">
    <!-- 引用列 -->
    <div class="table-ai-section is-inline" v-if="columnRefs.length > 0">
      <div class="table-ai-section-title">
        {{ editorMessage('editor.tableBlock.context.referenceColumns') }}
      </div>
      <div class="table-ai-section-content">
        <div class="table-ai-tags">
          <button
            v-for="(col, index) in columnRefs"
            :key="index"
            class="table-ai-tag"
            :class="{ 'is-active': isColumnRefActive(col.reference) }"
            :style="getColumnRefStyle(col.reference)"
            @click="handleColumnRefClick(col)"
            :title="formatTableBlockReferenceTitle(col.reference, editorMessage)"
          >
            {{ col.name }}
          </button>
        </div>
      </div>
    </div>
    
    <!-- 选区范围 -->
    <div class="table-ai-section is-inline" v-if="selectionRange">
      <div class="table-ai-section-title">
        {{ editorMessage('editor.tableBlock.context.selectionRange') }}
      </div>
      <div class="table-ai-section-content">
         <span 
          class="table-ai-tag selection-tag"
          :title="formatTableBlockSelectionRangeTitle(selectionRange, editorMessage)"
        >
          {{ selectionRange }}
        </span>
      </div>
    </div>

    <!-- 输出列 -->
    <div class="table-ai-section is-inline" v-if="outputColumnRange">
      <div class="table-ai-section-title">
        {{ editorMessage('editor.tableBlock.context.outputColumn') }}
      </div>
      <div class="table-ai-section-content">
        <span class="table-ai-tag output-column-display-tag">{{ outputColumnRange }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useEditorLocalization } from '../../../ui/useEditorLocalization';
import {
  formatTableBlockReferenceTitle,
  formatTableBlockSelectionRangeTitle,
} from '../functions/tableBlockPresentation';

const props = defineProps({
  columnRefs: {
    type: Array,
    default: () => []
  },
  selectionRange: {
    type: String,
    default: ''
  },
  outputColumnRange: {
    type: String,
    default: ''
  },
  activeColumnRefs: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(['column-ref-click']);
const { editorMessage } = useEditorLocalization();

// 列引用相关方法
const isColumnRefActive = (refKey) => {
  return props.activeColumnRefs && 
         props.activeColumnRefs[refKey] && 
         props.activeColumnRefs[refKey].active;
};

const getColumnRefStyle = (refKey) => {
  if (isColumnRefActive(refKey) && props.activeColumnRefs[refKey].color) {
    return {
      '--table-ai-ref-color': props.activeColumnRefs[refKey].color,
    };
  }
  return {};
};

const handleColumnRefClick = (col) => {
  emit('column-ref-click', col);
};
</script>
