<!--
 * packages/renderer-ui/src/icons/ui/DocumentPersonIcon.vue
 * “审阅”图标组件。
-->
<template>
  <svg
    class="shared-icon shared-icon--full linnya-ui-icon"
    data-icon="document-person"
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
        <circle cx="6.5" cy="14" r="3" fill="black" stroke="none"/>
        <path fill="black" stroke="black" stroke-width="2" d="M10 18.5c0 1.25-1 2.5-3.5 2.5S3 19.75 3 18.5c0-.83.67-1.5 1.5-1.5h4c.83 0 1.5.67 1.5 1.5z"/>
      </mask>
    </defs>
    <g :mask="`url(#${uid}-cut)`">
      <path d="M12.59 4.5H8A1.5 1.5 0 0 0 6.5 6v12A1.5 1.5 0 0 0 8 19.5h8a1.5 1.5 0 0 0 1.5-1.5V9.41a1 1 0 0 0-.29-.7l-3.92-3.92a1 1 0 0 0-.7-.29z"/>
      <path d="M12.5 4.5v4a1 1 0 0 0 1 1h4"/>
    </g>
    <circle cx="6.5" cy="14" r="2" fill="currentColor" stroke="none"/>
    <path fill="currentColor" stroke="none" d="M10 18.5c0 1.25-1 2.5-3.5 2.5S3 19.75 3 18.5c0-.83.67-1.5 1.5-1.5h4c.83 0 1.5.67 1.5 1.5z"/>
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue';

const uid = useId();
</script>
