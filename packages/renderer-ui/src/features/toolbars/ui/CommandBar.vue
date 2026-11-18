<template>
  <div class="linnya-command-bar" role="toolbar">
    <slot />
  </div>
</template>

<script setup lang="ts">
/**
 * 停靠在画布或文档顶部的命令条表面：Slides、Canvas、Markdown 共用同一外观。
 * 只拥有表面与间距；位置、显隐与命令由调用方负责，class/style/aria/事件落在根元素。
 */
defineSlots<{ default(): unknown }>();
</script>
