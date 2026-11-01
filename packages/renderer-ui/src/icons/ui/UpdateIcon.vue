<!--
 * packages/renderer-ui/src/icons/ui/UpdateIcon.vue
 * “应用更新”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="update"
    :data-state="props.progress == null ? 'idle' : 'progress'"
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
    <circle v-if="(props.progress == null ? 'idle' : 'progress') === 'progress'" cx="12" cy="12" r="7.5" opacity=".3"/>
    <circle data-part="ring" :stroke-dasharray="props.progress == null ? undefined : `${Math.min(100, Math.max(0, props.progress * 100))} 100`" cx="12" cy="12" r="7.5" pathLength="100" transform="rotate(-90 12 12)"/>
    <path d="M12 15.5v-7M9 11.5l3-3 3 3"/>
  </svg>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ progress?: number | null }>(), { progress: null });
</script>
