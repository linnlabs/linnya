<!--
 * packages/renderer-ui/src/icons/ui/FontSizeIcon.vue
 * “字号增减”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="font-size"
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
    <path d="M6 18.5L10.5 7.5L15 18.5M7.64 14.5h5.72"/>
    <path v-if="(props.direction) === 'increase'" d="M14 7.5l2-2 2 2"/>
    <path v-if="(props.direction) === 'decrease'" d="M14 5.5l2 2 2-2"/>
  </svg>
</template>

<script setup lang="ts">
const props = defineProps<{ readonly direction: 'increase' | 'decrease' }>();
</script>
