<!--
 * packages/renderer-ui/src/icons/ui/RunControlIcon.vue
 * “发送 / 暂停 / 继续”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="run-control"
    :data-state="props.action"
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
    <g data-part="send">
      <path d="M8.75 9.5L4.5 13.5l4.25 4M4.5 13.5H17a2.5 2.5 0 0 0 2.5-2.5V6.5"/>
    </g>
    <path data-part="control" fill="currentColor" d="M6.75 5.75L10.75 5.75L10.75 18.25L6.75 18.25Z M13.25 5.75L17.25 5.75L17.25 18.25L13.25 18.25Z"/>
  </svg>
</template>

<script setup lang="ts">
const props = defineProps<{ readonly action: 'send' | 'pause' | 'resume' }>();
</script>
