<template>
  <span ref="root" class="canvas-toolbar-menu">
    <ToolbarButton
      :label="label"
      :data-linnya-tooltip="tooltip ?? label"
      :active="Boolean(anchor)"
      :disabled="disabled"
      aria-haspopup="menu"
      :aria-expanded="Boolean(anchor)"
      @click="toggle"
    >
      <slot />
      <ChevronIcon
        v-if="arrow"
        direction="down"
        class="canvas-toolbar-menu-arrow"
        aria-hidden="true"
      />
    </ToolbarButton>
    <CanvasPortalMenu
      v-if="anchor"
      :label="label"
      :options="options"
      :model-value="modelValue"
      :anchor="anchor"
      :trigger="trigger"
      :min-width="minWidth"
      :show-selected-checkmark="showSelectedCheckmark"
      @select="choose"
      @close="close"
    />
  </span>
</template>
<script setup lang="ts" generic="Value extends string | number">
import { computed, ref, shallowRef } from 'vue';
import { ToolbarButton, type CustomSelectOption } from '@linnya/renderer-ui';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import type { CanvasMenuAnchor } from '../definitions/canvasMenu';
import CanvasPortalMenu from './CanvasPortalMenu.vue';

/** 工具条里的动作菜单：图标触发、标准 menu 语义，菜单本身沿用 CustomSelect。 */
const props = withDefaults(
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
const root = ref<HTMLElement | null>(null),
  anchor = shallowRef<CanvasMenuAnchor | null>(null);
const trigger = computed(() =>
  root.value?.firstElementChild instanceof HTMLElement ? root.value.firstElementChild : null
);
function toggle() {
  const rect = trigger.value?.getBoundingClientRect();
  anchor.value =
    anchor.value || !rect
      ? null
      : {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          align: props.align,
        };
}
function close(reason: 'escape' | 'outside') {
  anchor.value = null;
  if (reason === 'escape') trigger.value?.focus();
}
function choose(value: Value) {
  anchor.value = null;
  emit('select', value);
}
</script>
