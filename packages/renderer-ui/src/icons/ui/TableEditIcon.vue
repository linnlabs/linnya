<!--
 * packages/renderer-ui/src/icons/ui/TableEditIcon.vue
 * “编辑表格”图标组件。
-->
<template>
  <svg
    class="shared-icon shared-icon--full linnya-ui-icon"
    data-icon="table-edit"
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
        <path fill="black" stroke="black" stroke-width="2" d="M17.8 12.55l-4.82 4.83a2 2 0 0 0-.58 1.02l-.37 1.5a.9.9 0 0 0 1.08 1.07l1.5-.37q.58-.16 1.01-.58l4.83-4.83a1.87 1.87 0 0 0-2.64-2.64z"/>
      </mask>
    </defs>
    <g :mask="`url(#${uid}-cut)`">
      <rect x="5.5" y="5.5" width="13" height="13" rx="2"/>
      <path d="M9.5 5.5v13M14.5 5.5v13M5.5 9.5h13M5.5 14.5h13"/>
    </g>
    <path fill="currentColor" stroke="none" d="M17.8 12.55l-4.82 4.83a2 2 0 0 0-.58 1.02l-.37 1.5a.9.9 0 0 0 1.08 1.07l1.5-.37q.58-.16 1.01-.58l4.83-4.83a1.87 1.87 0 0 0-2.64-2.64z"/>
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue';

const uid = useId();
</script>
