<!--
 * packages/renderer-ui/src/icons/ui/DocumentArrowIcon.vue
 * “文档（箭头角标）”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="document-arrow"
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
        <circle cx="7.5" cy="16.5" r="5.5" fill="black" stroke="none"/>
      </mask>
      <mask :id="`${uid}-badge`" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none"/>
        <path stroke="black" d="M7.5 14.5l-2 2 2 2M5.5 16.5h4"/>
      </mask>
    </defs>
    <g :mask="`url(#${uid}-cut)`">
      <path d="M12.59 4.5H8A1.5 1.5 0 0 0 6.5 6v12A1.5 1.5 0 0 0 8 19.5h8a1.5 1.5 0 0 0 1.5-1.5V9.41a1 1 0 0 0-.29-.7l-3.92-3.92a1 1 0 0 0-.7-.29z"/>
      <path d="M12.5 4.5v4a1 1 0 0 0 1 1h4"/>
    </g>
    <circle cx="7.5" cy="16.5" r="4.5" fill="currentColor" stroke="none" :mask="`url(#${uid}-badge)`"/>
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue';

const uid = useId();
</script>
