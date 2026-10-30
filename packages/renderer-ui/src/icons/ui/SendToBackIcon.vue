<!--
 * packages/renderer-ui/src/icons/ui/SendToBackIcon.vue
 * “置于底层”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="send-to-back"
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
        <rect x="3.5" y="3.5" width="6" height="6" rx="1.5" fill="black" stroke="black" stroke-width="3"/>
        <rect x="14.5" y="14.5" width="6" height="6" rx="1.5" fill="black" stroke="black" stroke-width="3"/>
      </mask>
      <mask :id="`${uid}-inside`" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="8" y="8" width="8" height="8" rx="1.5" fill="white" stroke="none"/>
      </mask>
    </defs>
    <g :mask="`url(#${uid}-cut)`">
      <rect x="7.5" y="7.5" width="9" height="9" rx="2"/>
      <path stroke-linecap="butt" :mask="`url(#${uid}-inside)`" d="M1 17L17 1M4 17L17 4M7 17L17 7M10 17L17 10M13 17L17 13"/>
    </g>
    <rect x="3.5" y="3.5" width="6" height="6" rx="1.5"/>
    <rect x="14.5" y="14.5" width="6" height="6" rx="1.5"/>
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue';

const uid = useId();
</script>
