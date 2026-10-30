<!--
 * packages/renderer-ui/src/icons/ui/DistributeIcon.vue
 * “等距分布”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="distribute"
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
    <g v-if="(props.direction) === 'horizontal'">
      <rect x="3.5" y="6.5" width="4" height="11" rx="1.5"/>
      <rect x="9.5" y="6.5" width="4" height="11" rx="1.5"/>
      <rect x="15.5" y="6.5" width="4" height="11" rx="1.5"/>
    </g>
    <g v-if="(props.direction) === 'vertical'">
      <rect x="6.5" y="3.5" width="11" height="4" rx="1.5"/>
      <rect x="6.5" y="9.5" width="11" height="4" rx="1.5"/>
      <rect x="6.5" y="15.5" width="11" height="4" rx="1.5"/>
    </g>
  </svg>
</template>

<script setup lang="ts">
const props = defineProps<{ readonly direction: 'horizontal' | 'vertical' }>();
</script>
