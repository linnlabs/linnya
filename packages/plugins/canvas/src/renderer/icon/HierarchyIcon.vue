<!--
 * packages/plugins/canvas/src/renderer/icon/HierarchyIcon.vue
 * “层级（树状排布）”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="hierarchy"
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
      <rect x="4.5" y="9.5" width="5" height="5" rx="1" />
      <rect x="14.5" y="4.5" width="5" height="5" rx="1" />
      <rect x="14.5" y="14.5" width="5" height="5" rx="1" />
      <path d="M9.5 12H12M14.5 7H13a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1.5" />
    </g>
    <g v-if="props.direction === 'down'">
      <rect x="9.5" y="4.5" width="5" height="5" rx="1" />
      <rect x="4.5" y="14.5" width="5" height="5" rx="1" />
      <rect x="14.5" y="14.5" width="5" height="5" rx="1" />
      <path d="M12 9.5V12M7 14.5V13a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1.5" />
    </g>
  </svg>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ direction?: 'right' | 'down' }>(), { direction: 'right' });
</script>
