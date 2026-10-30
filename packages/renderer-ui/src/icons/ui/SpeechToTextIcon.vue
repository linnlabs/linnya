<!--
 * packages/renderer-ui/src/icons/ui/SpeechToTextIcon.vue
 * “语音转文字”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="speech-to-text"
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
        <rect x="15" y="11" width="4" height="6" rx="2" fill="black" stroke="black" stroke-width="2"/>
        <path stroke="black" stroke-width="3" d="M13.5 15a3.5 3.5 0 0 0 7 0M17 18.5v1"/>
      </mask>
    </defs>
    <g :mask="`url(#${uid}-cut)`">
      <rect x="4.5" y="5.5" width="15" height="11" rx="2"/>
      <path d="M7.5 8.5h4M7.5 11h6M7.5 13.5h4.5"/>
    </g>
    <rect x="15" y="11" width="4" height="6" rx="2" fill="currentColor" stroke="none"/>
    <path d="M13.5 15a3.5 3.5 0 0 0 7 0M17 18.5v1"/>
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue';

const uid = useId();
</script>
