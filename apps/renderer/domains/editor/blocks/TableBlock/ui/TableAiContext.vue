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

<script setup lang="ts" generic="Column extends { readonly name: string; readonly reference: string }">
import type { CSSProperties } from 'vue';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';
import {
  formatTableBlockReferenceTitle,
  formatTableBlockSelectionRangeTitle,
} from '../functions/tableBlockPresentation';

// Column 只要求标签需要的 name / reference；调用方传入的对象会原样随点击事件返回，所以组件按泛型保留其完整类型。
interface TableAiContextActiveColumn {
  readonly active: boolean;
  readonly color?: string;
}

const props = withDefaults(defineProps<{
  columnRefs?: readonly Column[];
  selectionRange?: string;
  outputColumnRange?: string;
  activeColumnRefs?: Readonly<Record<string, TableAiContextActiveColumn>>;
}>(), {
  columnRefs: () => [],
  selectionRange: '',
  outputColumnRange: '',
  activeColumnRefs: () => ({}),
});

const emit = defineEmits<{
  'column-ref-click': [column: Column];
}>();
const { editorMessage } = useEditorLocalization();

// 列引用相关方法
const isColumnRefActive = (refKey: string): boolean => {
  return props.activeColumnRefs[refKey]?.active === true;
};

const getColumnRefStyle = (refKey: string): CSSProperties => {
  const color = props.activeColumnRefs[refKey]?.color;
  if (isColumnRefActive(refKey) && color) {
    return {
      '--table-ai-ref-color': color,
    };
  }
  return {};
};

const handleColumnRefClick = (col: Column): void => {
  emit('column-ref-click', col);
};
</script>
