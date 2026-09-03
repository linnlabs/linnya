<template>
  <div class="toolbar-dropdown">
    <ToolbarButton
      @click="toggleDropdown"
      :title="title"
      :class="buttonClass"
    >
      <span
        class="toolbar-dropdown-trigger"
        :class="{ 'is-menu-open': isDropdownOpen }"
      >
        <slot name="trigger"></slot>
        <ChevronIcon class="chevron-icon" direction="down" />
      </span>
    </ToolbarButton>

    <!-- 使用通用 CustomSelect，保持全局统一的下拉行为 -->
    <!-- 外层加过渡，体验与 TextSelectionToolbar 的下拉对齐 -->
    <transition name="toolbar-dropdown-fade">
      <div v-if="isDropdownOpen" class="dropdown-container">
        <CustomSelect
          :model-value="null"
          :options="options"
          manual-mode
          variant="minimal"
          :bordered="false"
          min-width="140px"
          :parent-is-open="isDropdownOpen"
          :onSelect="handleSelect"
          @close="isDropdownOpen = false"
        />
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ToolbarButton from './ToolbarButton.vue';
import { CustomSelect } from '@linnya/renderer-ui';
import { ChevronIcon } from '@linnya/renderer-ui/icons';

export interface ToolbarDropdownOption {
  value: string;
  text: string;
  icon?: string;
}

const props = withDefaults(defineProps<{
  options: ReadonlyArray<ToolbarDropdownOption>;
  title?: string;
  buttonClass?: string;
  isOpen?: boolean;
}>(), {
  title: '',
  buttonClass: '',
  isOpen: false,
});

// 使用更明确的事件声明格式
const emit = defineEmits<{
  select: [value: string];
  'update:isOpen': [value: boolean];
}>();

defineSlots<{
  trigger?: () => unknown;
}>();

// 计算属性，用于同步内部状态和外部状态
const isDropdownOpen = computed({
  get: () => props.isOpen,
  set: (value) => emit('update:isOpen', value)
});

const toggleDropdown = () => {
  isDropdownOpen.value = !isDropdownOpen.value;
};

const handleSelect = (value: unknown) => {
  if (typeof value !== 'string') {
    console.warn('[ToolbarDropdown] 忽略非字符串菜单值', { value });
    return;
  }

  isDropdownOpen.value = false;
  emit('select', value);
};
</script>
