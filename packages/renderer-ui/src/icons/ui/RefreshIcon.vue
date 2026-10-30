<!--
 * packages/renderer-ui/src/icons/ui/RefreshIcon.vue
 * “刷新”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="refresh"
    :data-state="props.spinning ? 'spinning' : 'idle'"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <g data-part="spinner">
      <path d="M19.48 11.5A7.5 7.5 0 1 1 18.34 8"/>
      <path d="M18.5 4.5v4h-4"/>
    </g>
  </svg>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ spinning?: boolean }>(), { spinning: false });
</script>
