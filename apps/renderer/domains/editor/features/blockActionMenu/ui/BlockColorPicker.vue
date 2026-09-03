<!-- apps/renderer/shared/menus/blockActionMenu/ui/BlockColorPicker.vue -->
<!-- 块颜色选择器：类似 TableSizeSelector 的交互式颜色面板 -->

<template>
  <div 
    class="block-color-picker" 
    ref="containerRef"
    tabindex="0"
    @keydown="handleKeyDown"
    @click.stop
  >
    <ColorPickerPanel
      :background-colors="EDITOR_BLOCK_BACKGROUND_COLOR_OPTIONS"
      :text-colors="EDITOR_BLOCK_TEXT_COLOR_OPTIONS"
      :current-background-value="currentBgColor"
      :current-text-value="currentTextColor"
      :show-text="!isAtomic"
      :show-clear-button="hasColor"
      :clear-button-text="editorMessage('editor.blockMenu.color.clear')"
      :background-title="editorMessage('editor.blockMenu.color.background')"
      :text-title="editorMessage('editor.blockMenu.color.text')"
      :label-resolver="sharedComponentMessage"
      :no-padding="true"
      compare-mode="by-value"
      @select-background="handleBackgroundColorClick"
      @select-text="handleTextColorClick"
      @clear="handleClear"
    />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { ColorPickerPanel } from '@linnya/renderer-ui';
import { useSharedComponentLocalization } from '@linnya/renderer-ui/localization';
import {
  EDITOR_BLOCK_BACKGROUND_COLOR_OPTIONS,
  EDITOR_BLOCK_TEXT_COLOR_OPTIONS,
} from '../definitions/editorBlockColorPalette';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';

const props = defineProps({
  // 当前背景色
  currentBackgroundColor: {
    type: String,
    default: null
  },
  // 当前文字色
  currentTextColor: {
    type: String,
    default: null
  },
  // 块内是否存在任意文字颜色（来自块菜单或工具栏的 textColor mark）
  hasTextColor: {
    type: Boolean,
    default: false
  },
  // 新增：是否为原子块
  isAtomic: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['select-background', 'select-text', 'clear', 'cancel']);
const { editorMessage } = useEditorLocalization();
const { sharedComponentMessage } = useSharedComponentLocalization();

// 容器引用
const containerRef = ref(null);

// 当前颜色
const currentBgColor = ref(props.currentBackgroundColor);
const currentTextColor = ref(props.currentTextColor);

// 是否有颜色
const hasColor = computed(() => {
  return !!(currentBgColor.value || currentTextColor.value || props.hasTextColor);
});

// 处理背景色点击
const handleBackgroundColorClick = (color) => {
  currentBgColor.value = color.value;
  emit('select-background', color.value);
  console.log('[BlockColorPicker] 选择背景色:', color.value);
};

// 处理文字色点击
const handleTextColorClick = (color) => {
  currentTextColor.value = color.value;
  emit('select-text', color.value);
  console.log('[BlockColorPicker] 选择文字色:', color.value);
};

// 处理清除颜色
const handleClear = () => {
  currentBgColor.value = null;
  currentTextColor.value = null;
  emit('clear');
};

// 取消选择
const cancel = () => {
  emit('cancel');
};

// 键盘导航
const handleKeyDown = (event) => {
  const { key } = event;
  
  // Escape 取消
  if (key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }
};

// 点击外部关闭由 CustomSelect 处理，这里不需要
// onMounted 和 onBeforeUnmount 留空或移除
</script>
