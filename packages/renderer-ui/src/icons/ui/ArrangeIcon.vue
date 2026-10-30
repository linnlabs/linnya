<!--
 * packages/renderer-ui/src/icons/ui/ArrangeIcon.vue
 * “排列”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="arrange"
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
    <defs>
      <mask :id="`${uid}-cut`" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none"/>
        <rect x="4.5" y="4.5" width="10" height="10" rx="2" fill="black" stroke="black" stroke-width="3"/>
      </mask>
      <mask :id="`${uid}-inside`" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="5" y="5" width="9" height="9" rx="1.5" fill="white" stroke="none"/>
      </mask>
    </defs>
    <rect x="9.5" y="9.5" width="10" height="10" rx="2" :mask="`url(#${uid}-cut)`"/>
    <rect x="4.5" y="4.5" width="10" height="10" rx="2"/>
    <path stroke-linecap="butt" :mask="`url(#${uid}-inside)`" d="M-2 15L15 -2M1 15L15 1M4 15L15 4M7 15L15 7M10 15L15 10"/>
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue';

const uid = useId();
</script>
