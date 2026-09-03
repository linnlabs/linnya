<!--
  * @file apps/renderer/features/LatexBlock/ui/SymbolPalette.vue
  * @description 一个显示 LaTeX 符号选项板的 Vue 组件，用于快捷插入。
  *
  * 功能 (What):
  * - 从 `symbols.js` 导入符号数据。
  * - 使用选项卡（Tabs）来分类显示不同的符号类别（数学、函数等）。
  * - 在每个选项卡内，以网格布局展示可点击的符号按钮。
  * - 当用户点击一个符号按钮时，触发 `insert-symbol` 事件，并传递符号的 LaTeX 代码和光标偏移信息。
  *
  * 输入 (Input / @param):
  * - 无 props
  *
  * 输出 (Output / @returns):
  * - `insert-symbol` event: 触发一个自定义事件，携带一个包含 `insert` (string) 和 `moveCursor` (number | undefined) 的对象。
  *
  * 副作用 (Side-effects):
  * - 维护当前激活的选项卡状态。
-->
<template>
  <div class="symbol-palette">
    <div class="palette-tabs">
      <button
        v-for="category in symbolCategories"
        :key="category.id"
        :class="['tab-button', { active: activeTab === category.id }]"
        @click="activeTab = category.id"
      >
        {{ categoryLabel(category.id) }}
      </button>
    </div>
    <div class="palette-content">
      <div
        v-for="category in symbolCategories"
        :key="category.id"
        v-show="activeTab === category.id"
        class="symbol-grid"
      >
        <button
          v-for="symbol in category.symbols"
          :key="symbol.display"
          class="symbol-button"
          :title="symbol.insert"
          @click="handleSymbolClick(symbol)"
        >
          <KatexRenderer :latex="symbol.preview || symbol.insert" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { symbolCategories } from './symbols.js';
import KatexRenderer from './KatexRenderer.vue';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';

const emit = defineEmits(['insert-symbol']);
const { editorMessage } = useEditorLocalization();

const activeTab = ref(symbolCategories.length > 0 ? symbolCategories[0].id : '');

const categoryLabel = (categoryId) => {
  switch (categoryId) {
    case 'math':
      return editorMessage('editor.latexBlock.symbolCategory.math');
    case 'physics':
      return editorMessage('editor.latexBlock.symbolCategory.physics');
    case 'chemistry':
      return editorMessage('editor.latexBlock.symbolCategory.chemistry');
    case 'arrows':
      return editorMessage('editor.latexBlock.symbolCategory.arrows');
    case 'greekLetters':
      return editorMessage('editor.latexBlock.symbolCategory.greekLetters');
  }
};

const handleSymbolClick = (symbol) => {
  emit('insert-symbol', {
    insert: symbol.insert,
    moveCursor: symbol.moveCursor,
  });
};
</script>
