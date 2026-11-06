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
    <circle cx="6.5" cy="16.5" r="2" />
    <circle cx="17.5" cy="7.5" r="2" />
    <path v-if="props.shape === 'curve'" d="M8.5 16.5C12 16.5 12 7.5 15.5 7.5" />
    <path v-if="props.shape === 'straight'" d="M8.05 15.23L15.95 8.77" />
  </svg>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ shape?: 'curve' | 'straight' }>(), { shape: 'curve' });
</script>
