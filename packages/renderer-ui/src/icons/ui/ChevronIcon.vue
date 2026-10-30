<!--
 * packages/renderer-ui/src/icons/ui/ChevronIcon.vue
 * “方向箭头”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="chevron"
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
    <path data-part="arrow" :style="{ transform: `rotate(${ROTATION[props.direction]}deg)`, transformOrigin: '12px 12px' }" d="M6.5 9.5l5.5 5.5 5.5-5.5"/>
  </svg>
</template>

<script setup lang="ts">
const ROTATION = { down: 0, up: 180, left: 90, right: -90 } as const;
const props = withDefaults(defineProps<{ direction?: 'up' | 'down' | 'left' | 'right' }>(), { direction: 'down' });
</script>
