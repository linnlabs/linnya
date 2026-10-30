<!--
 * packages/renderer-ui/src/icons/ui/DuplicateIcon.vue
 * “复制一份”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="duplicate"
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
        <path stroke="black" d="M16.5 14.5v4M14.5 16.5h4"/>
      </mask>
    </defs>
    <path stroke-linecap="butt" d="M14.5 8V7A1.5 1.5 0 0 0 13 5.5H7A1.5 1.5 0 0 0 5.5 7v6A1.5 1.5 0 0 0 7 14.5h1"/>
    <rect x="9.5" y="9.5" width="9" height="9" rx="1.5" :mask="`url(#${uid}-cut)`"/>
    <circle cx="16.5" cy="16.5" r="4.5" fill="currentColor" stroke="none" :mask="`url(#${uid}-badge)`"/>
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue';

const uid = useId();
</script>
