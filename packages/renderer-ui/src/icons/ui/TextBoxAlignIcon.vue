<!--
 * packages/renderer-ui/src/icons/ui/TextBoxAlignIcon.vue
 * “文本框内对齐”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="text-box-align"
    :data-state="props.alignment"
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
    <rect x="5.5" y="5.5" width="13" height="13" rx="2"/>
    <path v-if="(props.alignment) === 'middle'" d="M8.5 10.5h7M8.5 13.5h7"/>
    <path v-if="(props.alignment) === 'bottom'" d="M8.5 12.5h7M8.5 15.5h7"/>
  </svg>
</template>

<script setup lang="ts">
const props = defineProps<{ readonly alignment: 'middle' | 'bottom' }>();
</script>
