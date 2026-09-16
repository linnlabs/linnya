<template>
  <DropdownTransition :direction="direction">
    <div
      v-if="show"
      ref="element"
      class="linnya-dropdown-panel"
      v-bind="$attrs"
    >
      <slot />
    </div>
  </DropdownTransition>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { DropdownPanelProps } from '../definitions/dropdownPanel';
import DropdownTransition from './DropdownTransition.vue';
defineOptions({ inheritAttrs: false });
defineProps<DropdownPanelProps>();
defineSlots<{ default(): unknown }>();
const element = ref<HTMLDivElement | null>(null);
// 动画只作用于面板；定位和关闭意图由调用方／BaseDropdown 持有。
defineExpose({ element });
</script>
