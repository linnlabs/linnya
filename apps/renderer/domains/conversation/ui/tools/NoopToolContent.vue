<template>
  <!--
    NoopToolContent

    中文备注：
    - 该组件用于满足 Tool UI Registry 的 component 类型要求；
    - 当某些工具只需要展示 header（layout.hideContent=true）时，内容区不会挂载，因此该组件不会被渲染。
  -->
  <div />
</template>

<script setup lang="ts">
defineProps<{
  args: Record<string, unknown>;
  result?: unknown;
  status: string;
  messageId?: string;
}>();
</script>

