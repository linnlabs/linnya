<!--
 * packages/renderer-ui/src/icons/ui/LinnyaIcon.vue
 * “Linnya 标识”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon shared-icon shared-icon--em linnya-icon"
    data-icon="linnya"
    :data-state="props.variant"
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
    <path v-if="(props.variant) === 'compact'" fill="currentColor" stroke="none" d="M12.1 12.75C10.87 9.22 12.78 5.96 18.33 2.04C17.99 8.72 16.39 12.16 13.02 13.32C13.44 11.41 14.32 8.99 15.66 6.6C14.09 8.71 12.89 10.91 12.1 12.75Z M10.1 22.3C9.79 20.46 10.26 18.54 10.68 16.75C10.94 15.64 11.47 14.57 12.32 13.79C12.6 14.92 12.28 16.11 11.81 17.14C11.06 18.8 10.43 20.5 10.1 22.3Z M11.4 13.4C8.22 13.61 5.8 12.03 4.27 8.77C8.01 8.63 10.43 10.2 11.4 13.4Z"/>
    <path v-if="(props.variant) === 'display'" fill="currentColor" stroke="none" d="M12.18 13C10.78 9.37 12.65 6.05 18.33 2.04C17.99 8.85 16.33 12.29 12.82 13.38C13.29 11.46 14.25 9.01 15.66 6.6C14.09 8.81 12.91 11.11 12.18 13Z M10.1 22.3C9.9 20.44 10.41 18.54 10.89 16.75C11.18 15.66 11.65 14.59 12.34 13.69C12.44 14.83 12.07 15.97 11.64 17.01C10.95 18.72 10.33 20.46 10.1 22.3Z M11.4 13.4C8.22 13.61 5.8 12.03 4.27 8.77C8.01 8.63 10.43 10.2 11.4 13.4Z"/>
  </svg>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ variant?: 'compact' | 'display' }>(), { variant: 'compact' });
</script>
