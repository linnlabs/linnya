<!--
 * packages/renderer-ui/src/icons/ui/DocumentEditIcon.vue
 * “编辑文件”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="document-edit"
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
        <path fill="black" stroke="black" stroke-width="2" d="M16.8 11.55a1.87 1.87 0 1 1 2.65 2.64l-4.83 4.83a2 2 0 0 1-1.02.58l-1.5.37a.9.9 0 0 1-1.07-1.07l.37-1.5q.15-.6.58-1.02z"/>
      </mask>
    </defs>
    <g :mask="`url(#${uid}-cut)`">
      <path d="M12 19.5H8A1.5 1.5 0 0 1 6.5 18V6A1.5 1.5 0 0 1 8 4.5h4.59a1 1 0 0 1 .7.29l3.92 3.92a1 1 0 0 1 .29.7V9.5h-4a1 1 0 0 1-1-1v-4"/>
    </g>
    <path fill="currentColor" stroke="none" d="M16.8 11.55a1.87 1.87 0 1 1 2.65 2.64l-4.83 4.83a2 2 0 0 1-1.02.58l-1.5.37a.9.9 0 0 1-1.07-1.07l.37-1.5q.15-.6.58-1.02z"/>
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue';

const uid = useId();
</script>
