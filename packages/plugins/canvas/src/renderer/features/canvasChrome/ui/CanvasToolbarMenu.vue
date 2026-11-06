<template>
  <span ref="root" class="canvas-toolbar-menu">
    <ToolbarButton
      :label="label"
      :data-linnya-tooltip="tooltip ?? label"
      :active="open"
      :disabled="disabled"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open = !open"
    >
      <slot />
      <ChevronIcon
        v-if="arrow"
        direction="down"
        class="canvas-toolbar-menu-arrow"
        aria-hidden="true"
      />
    </ToolbarButton>
    <div v-if="open" class="canvas-toolbar-menu-panel" :class="{ 'is-end': align === 'end' }">
      <CustomSelect
        :model-value="modelValue ?? null"
        :options="options"
        :manual-mode="true"
        :parent-is-open="open"
        :external-trigger-ref="trigger"
        semantic-role="menu"
        variant="minimal"
        :min-width="minWidth"
        :show-selected-checkmark="showSelectedCheckmark"
        @update:model-value="choose"
        @close="open = false"
      />
    </div>
  </span>
</template>
<script setup lang="ts" generic="Value extends string | number">
import { computed, ref } from 'vue';
import { CustomSelect, ToolbarButton, type CustomSelectOption } from '@linnya/renderer-ui';
import { ChevronIcon } from '@linnya/renderer-ui/icons';

/** 工具条里的动作菜单：图标触发、标准 menu 语义，菜单本身沿用 CustomSelect。 */
withDefaults(
  defineProps<{
    label: string;
    tooltip?: string;
    options: readonly CustomSelectOption<Value>[];
    modelValue?: Value | null;
    disabled?: boolean;
    minWidth?: string;
    showSelectedCheckmark?: boolean;
    align?: 'start' | 'end';
    /** 图标本身已表示“更多”时不再画下拉箭头。 */
    arrow?: boolean;
  }>(),
  { tooltip: undefined, modelValue: null, minWidth: '160px', align: 'start', arrow: true }
);
const emit = defineEmits<{ select: [value: Value] }>();
defineSlots<{ default(): unknown }>();
const open = ref(false),
  root = ref<HTMLElement | null>(null);
const trigger = computed(() =>
  root.value?.firstElementChild instanceof HTMLElement ? root.value.firstElementChild : null
);
const choose = (value: Value) => {
  open.value = false;
  emit('select', value);
};
</script>
