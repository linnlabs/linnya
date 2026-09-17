<!-- Editor floating-toolbar 私有颜色选择面板；只消费本 feature 的色板合同。 -->
<!--
  行内文字颜色选择面板
  规范：布局/交互与 BlockColorPicker 保持一致，仅背景色不同
-->
<template>
  <div
    class="inline-color-picker block-color-picker"
    ref="containerRef"
    tabindex="0"
    @click.stop
  >
    <div class="color-section">
      <div class="section-title">{{ title }}</div>
      <div class="color-grid">
        <button
          v-for="color in textColors"
          :key="color.value"
          class="color-cell text-color-cell"
          :class="{ 'is-current': modelValue === color.value }"
          :title="color.label"
          :style="{
            '--cell-border-color': `color-mix(in srgb, var(${color.cssVar}) 40%, white)`
          }"
          @click="handleSelect(color.value)"
        >
          <span class="color-sample" :style="{ color: `var(${color.cssVar})` }">A</span>
        </button>
      </div>
    </div>

    <div v-if="hasColor" class="picker-footer">
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
  readonly hasColor: boolean;
  readonly title: string;
  readonly clearLabel: string;
  readonly textColors: readonly FloatingToolbarColorOption[];
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string | null): void;
  (event: 'select', value: string): void;
  (event: 'clear'): void;
}>();

// Escape 由外层 BaseDropdown 统一关闭并归还焦点。
const containerRef = ref(null);

const handleSelect = (value: string) => {
  emit('update:modelValue', value);
  emit('select', value);
};

const handleClear = () => {
  emit('update:modelValue', null);
  emit('clear');
};

</script>
