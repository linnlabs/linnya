<!-- apps/renderer/shared/menus/blockActionMenu/ui/ColorPalette.vue -->
<!--
  颜色选择面板组件
  
  功能：
  - 显示预设的背景色和文字色选项
  - 支持选择颜色或清除颜色
  - 类似 Notion 的颜色面板设计
-->

<template>
  <div class="block-action-color-palette" @click.stop>
    <ColorPickerPanel
      :background-colors="EDITOR_BLOCK_BACKGROUND_COLOR_OPTIONS"
      :text-colors="EDITOR_BLOCK_TEXT_COLOR_OPTIONS"
      :current-background-value="props.currentBackgroundColor"
      :current-text-value="props.currentTextColor"
      :show-background="true"
      :show-text="true"
      :show-clear-button="true"
      :clear-button-text="editorMessage('editor.blockMenu.color.clear')"
      :background-title="editorMessage('editor.blockMenu.color.background')"
      :text-title="editorMessage('editor.blockMenu.color.text')"
      :label-resolver="sharedComponentMessage"
      compare-mode="by-value"
      @select-background="handleBackgroundColorSelect"
      @select-text="handleTextColorSelect"
      @clear="handleClearColors"
    />
  </div>
</template>

<script setup lang="ts">
import { ColorPickerPanel } from '@linnya/renderer-ui';
import { useSharedComponentLocalization } from '@linnya/renderer-ui/localization';
import {
  EDITOR_BLOCK_BACKGROUND_COLOR_OPTIONS,
  EDITOR_BLOCK_TEXT_COLOR_OPTIONS,
  type EditorBlockColorOption,
} from '../definitions/editorBlockColorPalette';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';

const props = defineProps({
  currentBackgroundColor: {
    type: String,
    default: null
  },
  currentTextColor: {
    type: String,
    default: null
  }
});

const emit = defineEmits(['select-background', 'select-text', 'clear']);
const { editorMessage } = useEditorLocalization();
const { sharedComponentMessage } = useSharedComponentLocalization();

const handleBackgroundColorSelect = (color: EditorBlockColorOption) => {
  emit('select-background', color.value);
};

const handleTextColorSelect = (color: EditorBlockColorOption) => {
  emit('select-text', color.value);
};

const handleClearColors = () => {
  emit('clear');
};
</script>
