<!--
 * packages/plugins/canvas/src/renderer/icon/ConnectorIcon.vue
 * “连接（曲线 / 直线）”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="connector"
    :data-state="props.shape"
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
    <circle cx="6.5" cy="17.5" r="2" />
    <circle cx="17.5" cy="6.5" r="2" />
    <path v-if="props.shape === 'curve'" d="M6.5 15.5A9 9 0 0 1 15.5 6.5" />
    <path v-if="props.shape === 'straight'" d="M7.91 16.09L16.09 7.91" />
  </svg>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ shape?: 'curve' | 'straight' }>(), { shape: 'curve' });
</script>
