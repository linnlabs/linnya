<!--
 * packages/renderer-ui/src/icons/ui/WindowActionIcon.vue
 * “窗口按钮”图标组件。
-->
<template>
  <svg
    class="shared-icon shared-icon--em linnya-ui-icon"
    data-icon="window-action"
    :data-state="props.action === 'minimize' ? 'minimize' : props.isMaximized ? 'restore' : 'maximize'"
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
      <mask :id="`${uid}-front`" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none"/>
        <rect x="3" y="6" width="15" height="15" rx="3.5" fill="black" stroke="none"/>
      </mask>
    </defs>
    <path v-if="(props.action === 'minimize' ? 'minimize' : props.isMaximized ? 'restore' : 'maximize') === 'minimize'" d="M5.5 12h13"/>
    <rect v-if="(props.action === 'minimize' ? 'minimize' : props.isMaximized ? 'restore' : 'maximize') === 'maximize'" x="5.5" y="5.5" width="13" height="13" rx="1.5"/>
    <g v-if="(props.action === 'minimize' ? 'minimize' : props.isMaximized ? 'restore' : 'maximize') === 'restore'">
      <path :mask="`url(#${uid}-front)`" stroke-linecap="butt" d="M7.5 8V6.5a2 2 0 0 1 2-2H16a3.5 3.5 0 0 1 3.5 3.5v6.5a2 2 0 0 1-2 2H16"/>
      <rect x="4.5" y="7.5" width="12" height="12" rx="2"/>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue';

const props = withDefaults(defineProps<{ readonly action: 'minimize' | 'maximize'; isMaximized?: boolean }>(), { isMaximized: false });
const uid = useId();
</script>
