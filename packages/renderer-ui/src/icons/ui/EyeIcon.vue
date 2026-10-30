<!--
 * packages/renderer-ui/src/icons/ui/EyeIcon.vue
 * “显示 / 隐藏”图标组件。
-->
<template>
  <svg
    class="shared-icon linnya-ui-icon"
    data-icon="eye"
    :data-state="props.visible ? 'visible' : 'hidden'"
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
      <mask :id="`${uid}-mask`" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none"/>
        <path data-part="gap" stroke="black" stroke-width="1.5" stroke-linecap="butt" pathLength="1" d="M5.03 3.97l15 15"/>
      </mask>
    </defs>
    <g :mask="`url(#${uid}-mask)`">
      <path d="M4.77 13.5a7.36 7.36 0 0 1 14.46 0"/>
      <circle cx="12" cy="13.5" r="3"/>
    </g>
    <path data-part="slash" pathLength="1" d="M4.5 4.5l15 15"/>
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue';

const props = defineProps<{ readonly visible: boolean }>();
const uid = useId();
</script>
