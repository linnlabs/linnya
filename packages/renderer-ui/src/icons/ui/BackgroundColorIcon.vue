<!--
 * BackgroundColorIcon
 * 背景颜色图标（参考 TextSelectionToolbar 的高亮按钮形态）
-->
<template>
  <span class="background-color-icon" aria-hidden="true">
    <EditIcon class="background-edit-icon" />
    <span class="background-color-indicator" :style="{ backgroundColor: indicatorColor }"></span>
  </span>
</template>

<script setup lang="ts">
import EditIcon from './EditIcon.vue';

withDefaults(defineProps<{
  indicatorColor?: string;
}>(), {
  indicatorColor: 'currentColor',
});
</script>
