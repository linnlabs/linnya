<template>
  <div
    v-if="show"
    ref="element"
    class="linnya-floating-toolbar"
    :style="{ top: `${position.top}px`, left: `${position.left}px` }"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { FloatingToolbarProps } from '../definitions/toolbar';

defineProps<FloatingToolbarProps>();
defineSlots<{ default(): unknown }>();
const element = ref<HTMLDivElement | null>(null);
// 暴露实际表面用于调用方测量；不以估算宽度限制不同业务的内容。
defineExpose({ element });
// 选区保留属于 Editor；默认不阻止 mousedown，保证表单控件能原生聚焦。
</script>
