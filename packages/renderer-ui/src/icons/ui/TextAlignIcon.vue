<!--
 * packages/renderer-ui/src/icons/ui/TextAlignIcon.vue
 * “对齐”图标组件。
-->
<template>
  <svg
    class="shared-icon shared-icon--full linnya-ui-icon"
    data-icon="text-align"
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
    <path d="M4.5 12h15"/>
    <path v-if="(props.alignment) === 'left'" d="M4.5 7h11M4.5 17h9"/>
    <path v-if="(props.alignment) === 'center'" d="M6.5 7h11M8.5 17h7"/>
    <path v-if="(props.alignment) === 'right'" d="M8.5 7h11M11.5 17h8"/>
  </svg>
</template>

<script setup lang="ts">
const props = defineProps<{ readonly alignment: 'left' | 'center' | 'right' }>();
</script>
