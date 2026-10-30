<!--
 * packages/renderer-ui/src/icons/ui/LinnyaLoadingIcon.vue
 * “Linnya 进行中”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon linnya-icon"
    data-icon="linnya-loading"
    :data-state="props.activity"
    width="18" height="18" :style="props.color ? { color: props.color } : undefined"
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
      <linearGradient :id="`${uid}-fade`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="white" stop-opacity="0"/>
        <stop offset="0.125" stop-color="white" stop-opacity="0.15"/>
        <stop offset="0.25" stop-color="white" stop-opacity="0.5"/>
        <stop offset="0.375" stop-color="white" stop-opacity="0.85"/>
        <stop offset="0.5" stop-color="white"/>
        <stop offset="0.625" stop-color="white" stop-opacity="0.85"/>
        <stop offset="0.75" stop-color="white" stop-opacity="0.5"/>
        <stop offset="0.875" stop-color="white" stop-opacity="0.15"/>
        <stop offset="1" stop-color="white" stop-opacity="0"/>
      </linearGradient>
      <mask :id="`${uid}-flow`" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect data-part="band" x="0" y="0" width="24" height="14" :fill="`url(#${uid}-fade)`" stroke="none"/>
      </mask>
      <mask :id="`${uid}-grow`" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <path data-part="stem-reveal" d="M10.63 23.8C10.8 21.5 11.4 19.5 11.9 17.5C12.3 15.9 12.8 14.6 13.4 13.4" stroke="white" stroke-width="3.5" pathLength="1"/>
      </mask>
    </defs>
    <path data-part="ghost" fill="currentColor" stroke="none" d="M12.91 12.66C11.51 8.63 13.69 4.9 20.03 0.42C19.65 8.06 17.82 11.99 13.97 13.31C14.45 11.13 15.45 8.37 16.98 5.63C15.19 8.05 13.82 10.56 12.91 12.66Z M10.63 23.58C10.27 21.47 10.81 19.28 11.29 17.23C11.59 15.97 12.19 14.74 13.17 13.85C13.49 15.14 13.12 16.5 12.58 17.68C11.73 19.58 11.01 21.52 10.63 23.58Z M12.11 13.41C8.48 13.65 5.71 11.84 3.97 8.11C8.24 7.95 11.01 9.75 12.11 13.41Z"/>
    <g data-part="plant" fill="currentColor" stroke="none">
      <path data-part="stem" :mask="`url(#${uid}-grow)`" d="M10.63 23.58C10.27 21.47 10.81 19.28 11.29 17.23C11.59 15.97 12.19 14.74 13.17 13.85C13.49 15.14 13.12 16.5 12.58 17.68C11.73 19.58 11.01 21.52 10.63 23.58Z"/>
      <path data-part="leaf-left" d="M12.11 13.41C8.48 13.65 5.71 11.84 3.97 8.11C8.24 7.95 11.01 9.75 12.11 13.41Z"/>
      <path data-part="leaf-right" d="M12.91 12.66C11.51 8.63 13.69 4.9 20.03 0.42C19.65 8.06 17.82 11.99 13.97 13.31C14.45 11.13 15.45 8.37 16.98 5.63C15.19 8.05 13.82 10.56 12.91 12.66Z"/>
    </g>
    <path data-part="flow" fill="currentColor" stroke="none" :mask="`url(#${uid}-flow)`" d="M12.91 12.66C11.51 8.63 13.69 4.9 20.03 0.42C19.65 8.06 17.82 11.99 13.97 13.31C14.45 11.13 15.45 8.37 16.98 5.63C15.19 8.05 13.82 10.56 12.91 12.66Z M10.63 23.58C10.27 21.47 10.81 19.28 11.29 17.23C11.59 15.97 12.19 14.74 13.17 13.85C13.49 15.14 13.12 16.5 12.58 17.68C11.73 19.58 11.01 21.52 10.63 23.58Z M12.11 13.41C8.48 13.65 5.71 11.84 3.97 8.11C8.24 7.95 11.01 9.75 12.11 13.41Z"/>
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue';

const props = withDefaults(defineProps<{ activity?: 'processing' | 'thinking' | 'generating'; color?: string }>(), { activity: 'processing' });
const uid = useId();
</script>
