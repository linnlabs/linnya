<!--
 * packages/renderer-ui/src/icons/ui/FolderAddIcon.vue
 * “新建文件夹”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="folder-add"
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
    <g :mask="`url(#${uid}-cut)`">
      <path d="M9.5 5.5h-3a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6z"/>
      <path d="M4.5 9h5l2-2"/>
    </g>
    <circle cx="16.5" cy="16.5" r="4.5" fill="currentColor" stroke="none" :mask="`url(#${uid}-badge)`"/>
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue';

const uid = useId();
</script>
