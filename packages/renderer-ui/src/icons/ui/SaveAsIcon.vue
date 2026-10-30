<!--
 * packages/renderer-ui/src/icons/ui/SaveAsIcon.vue
 * “另存为”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="save-as"
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
        <circle cx="16.5" cy="16.5" r="5.5" fill="black" stroke="none"/>
      </mask>
      <mask :id="`${uid}-badge`" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none"/>
        <path stroke="black" d="M14.5 16.5h4M16.5 14.5l2 2-2 2"/>
      </mask>
    </defs>
    <g :mask="`url(#${uid}-cut)`">
      <path d="M7 5.5L15.39 5.5A1.5 1.5 0 0 1 16.45 5.94L18.06 7.55A1.5 1.5 0 0 1 18.5 8.61L18.5 17A1.5 1.5 0 0 1 17 18.5L7 18.5A1.5 1.5 0 0 1 5.5 17L5.5 7A1.5 1.5 0 0 1 7 5.5z"/>
      <path d="M8.5 5.5v3a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-3M7.5 18.5v-5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v5"/>
    </g>
    <circle cx="16.5" cy="16.5" r="4.5" fill="currentColor" stroke="none" :mask="`url(#${uid}-badge)`"/>
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue';

const uid = useId();
</script>
