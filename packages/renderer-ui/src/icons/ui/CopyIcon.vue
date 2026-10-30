<!--
 * packages/renderer-ui/src/icons/ui/CopyIcon.vue
 * “复制”图标组件。
-->
<template>
  <svg
    class="shared-icon shared-icon--full linnya-ui-icon"
    data-icon="copy"
    :data-state="props.copied ? 'copied' : 'default'"
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
    <g data-part="sheets">
      <path stroke-linecap="butt" d="M14.5 8V7A1.5 1.5 0 0 0 13 5.5H7A1.5 1.5 0 0 0 5.5 7v6A1.5 1.5 0 0 0 7 14.5h1"/>
      <rect x="9.5" y="9.5" width="9" height="9" rx="1.5"/>
    </g>
    <path data-part="check" pathLength="1" d="M5 12.5l4 4.5L19.5 6.5"/>
  </svg>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ copied?: boolean }>(), { copied: false });
</script>
