<!--
 * packages/renderer-ui/src/icons/ui/MoreIcon.vue
 * “更多”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="more"
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
    <g data-part="dots" :style="{ transform: `rotate(${ROTATION[props.direction]}deg)`, transformOrigin: '12px 12px' }" fill="currentColor" stroke="none">
      <circle cx="7" cy="12" r="1.25"/>
      <circle cx="12" cy="12" r="1.25"/>
      <circle cx="17" cy="12" r="1.25"/>
    </g>
  </svg>
</template>

<script setup lang="ts">
const ROTATION = { vertical: 90, horizontal: 0 } as const;
const props = withDefaults(defineProps<{ direction?: 'vertical' | 'horizontal' }>(), { direction: 'vertical' });
</script>
