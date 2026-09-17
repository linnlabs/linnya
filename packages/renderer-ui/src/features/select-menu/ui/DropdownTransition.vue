<template>
  <Transition
    :name="direction === 'up' ? 'linnya-dropdown-up' : 'linnya-dropdown-down'"
    appear
    @before-enter="setInteractive($event, true)"
    @before-leave="setInteractive($event, false)"
    @leave-cancelled="setInteractive($event, true)"
  >
    <slot />
  </Transition>
</template>

<script setup lang="ts">
import type { DropdownMotionDirection } from '../definitions/dropdownPanel';
defineProps<{ direction?: DropdownMotionDirection }>();
defineSlots<{ default(): unknown }>();
function setInteractive(element: Element, interactive: boolean): void {
  // 退出动画中的旧表面不能继续接收 Tab 或点击；重开时恢复同一节点。
  if (element instanceof HTMLElement) element.inert = !interactive;
}
</script>
