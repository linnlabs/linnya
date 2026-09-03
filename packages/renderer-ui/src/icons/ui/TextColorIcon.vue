<!--
 * TextColorIcon
 * 文字颜色图标（参考 TextSelectionToolbar 的 A + 下方色条）
-->
<template>
  <span class="text-color-icon" aria-hidden="true">
    A
    <span class="text-color-indicator" :style="{ backgroundColor: indicatorColor }"></span>
  </span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  indicatorColor?: string;
}>(), {
  indicatorColor: 'currentColor',
});
</script>
