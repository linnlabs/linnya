<!--
 * packages/plugins/canvas/src/renderer/icon/LayeredGraphIcon.vue
 * “分层图（分层排布）”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="layered-graph"
    :data-state="props.direction"
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
    <g v-if="props.direction === 'right'">
      <rect x="4.5" y="5.5" width="5" height="4" rx="1" />
      <rect x="4.5" y="14.5" width="5" height="4" rx="1" />
      <rect x="14.5" y="5.5" width="5" height="4" rx="1" />
      <rect x="14.5" y="14.5" width="5" height="4" rx="1" />
      <path d="M9.5 7.5h5M9.5 16.5h5M9.5 7.5l5 9" />
    </g>
    <g v-if="props.direction === 'down'">
      <rect x="14.5" y="4.5" width="4" height="5" rx="1" />
      <rect x="5.5" y="4.5" width="4" height="5" rx="1" />
      <rect x="14.5" y="14.5" width="4" height="5" rx="1" />
      <rect x="5.5" y="14.5" width="4" height="5" rx="1" />
      <path d="M16.5 9.5v5M7.5 9.5v5M16.5 9.5l-9 5" />
    </g>
  </svg>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ direction?: 'right' | 'down' }>(), { direction: 'right' });
</script>
