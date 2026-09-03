<!-- Editor floating-toolbar 私有高亮选择面板；只消费本 feature 的色板合同。 -->
<!--
  行内文字高亮选择面板
  规范：布局/交互与 InlineTextColorPicker 保持一致，只是背景色不同
-->
<template>
  <div
    class="inline-highlight-picker block-color-picker"
    ref="containerRef"
    tabindex="0"
    @keydown="handleKeyDown"
    @click.stop
  >
    <div class="color-section">
      <div class="section-title">{{ title }}</div>
      <div class="color-grid">
        <button
          v-for="color in highlightColors"
          :key="color.value"
          class="color-cell highlight-color-cell"
          :class="{ 'is-current': modelValue === color.value }"
          :title="color.label"
          :style="{
            '--cell-background': `color-mix(in srgb, var(${color.cssVar}) ${getMixRatio(color.value)}, transparent)`,
            '--cell-border-color': color.value.startsWith('bright_') 
              ? `color-mix(in srgb, var(${color.cssVar}), black 10%)` 
              : `color-mix(in srgb, var(${color.cssVar}) 40%, white)`
          }"
          @click="handleSelect(color.value)"
        >
          <!-- 显示高亮效果的预览 -->
          <span class="highlight-sample">A</span>
        </button>
      </div>
    </div>

    <div v-if="hasHighlight" class="picker-footer">
      <ActionButtons
        :show-primary-action="false"
        :secondary-action-text="clearLabel"
        @secondary-click="handleClear"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ActionButtons } from '@linnya/renderer-ui';
import type { FloatingToolbarColorOption } from '../functions/floatingToolbarPresentation';

defineProps<{
  readonly modelValue: string | null;
  readonly hasHighlight: boolean;
  readonly title: string;
  readonly clearLabel: string;
  readonly highlightColors: readonly FloatingToolbarColorOption[];
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string | null): void;
  (event: 'select', value: string): void;
  (event: 'clear'): void;
}>();

// 容器引用 + Esc 关闭支持
const containerRef = ref(null);

const handleSelect = (value: string) => {
  emit('update:modelValue', value);
  emit('select', value);
};

const handleClear = () => {
  emit('update:modelValue', null);
  emit('clear');
};

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.stopPropagation();
    event.preventDefault();
  }
};

// 获取混合比例，与 TextHighlightMark 保持一致
const getMixRatio = (colorValue: string) => {
  if (colorValue === 'bright_yellow') {
    return '60%';
  }
  if (colorValue.startsWith('bright_')) {
    return '50%';
  }
  return '20%';
};
</script>
