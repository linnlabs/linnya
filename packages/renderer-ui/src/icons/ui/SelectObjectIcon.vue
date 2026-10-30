<!--
 * packages/renderer-ui/src/icons/ui/SelectObjectIcon.vue
 * “选择元素”图标组件。
-->
<template>
  <svg
    class="shared-icon shared-icon--full linnya-ui-icon"
    data-icon="select-object"
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
        <path fill="black" stroke="black" stroke-width="3" d="M12.5 11.5V18.5L14.25 16L17.5 16.5Z"/>
      </mask>
    </defs>
    <rect x="4.5" y="5.5" width="15" height="10" rx="1.5" :mask="`url(#${uid}-cut)`"/>
    <path d="M12.5 11.5V18.5L14.25 16L17.5 16.5Z"/>
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue';

const uid = useId();
</script>
