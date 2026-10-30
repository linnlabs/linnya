<!--
 * packages/renderer-ui/src/icons/ui/AlignObjectsIcon.vue
 * “对齐对象”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="align-objects"
    :data-state="props.alignment"
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
    <g v-if="(props.alignment) === 'left'">
      <path d="M5.5 4.5v15"/>
      <rect x="7.5" y="6.5" width="11" height="4" rx="1.5"/>
      <rect x="7.5" y="13.5" width="8" height="4" rx="1.5"/>
    </g>
    <g v-if="(props.alignment) === 'center'">
      <path d="M12.5 4.5v2M12.5 10.5v3M12.5 17.5v2"/>
      <rect x="6.5" y="6.5" width="12" height="4" rx="1.5"/>
      <rect x="8.5" y="13.5" width="8" height="4" rx="1.5"/>
    </g>
    <g v-if="(props.alignment) === 'right'">
      <path d="M18.5 4.5v15"/>
      <rect x="5.5" y="6.5" width="11" height="4" rx="1.5"/>
      <rect x="8.5" y="13.5" width="8" height="4" rx="1.5"/>
    </g>
    <g v-if="(props.alignment) === 'top'">
      <path d="M4.5 5.5h15"/>
      <rect x="6.5" y="7.5" width="4" height="11" rx="1.5"/>
      <rect x="13.5" y="7.5" width="4" height="8" rx="1.5"/>
    </g>
    <g v-if="(props.alignment) === 'middle'">
      <path d="M4.5 11.5h2M10.5 11.5h3M17.5 11.5h2"/>
      <rect x="6.5" y="5.5" width="4" height="12" rx="1.5"/>
      <rect x="13.5" y="7.5" width="4" height="8" rx="1.5"/>
    </g>
    <g v-if="(props.alignment) === 'bottom'">
      <path d="M4.5 18.5h15"/>
      <rect x="6.5" y="5.5" width="4" height="11" rx="1.5"/>
      <rect x="13.5" y="8.5" width="4" height="8" rx="1.5"/>
    </g>
  </svg>
</template>

<script setup lang="ts">
const props = defineProps<{ readonly alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' }>();
</script>
