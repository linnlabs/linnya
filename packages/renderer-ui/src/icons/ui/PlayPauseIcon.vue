<!--
 * packages/renderer-ui/src/icons/ui/PlayPauseIcon.vue
 * “播放 / 暂停”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="play-pause"
    :data-state="props.playing ? 'playing' : 'paused'"
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
    <circle cx="12" cy="12" r="7.5"/>
    <g data-part="play">
      <path fill="currentColor" stroke="none" d="M11.13 9.18A.75.75 0 0 0 10 9.83v4.34c0 .57.63.94 1.13.65l4.12-2.39a.5.5 0 0 0 0-.86z"/>
    </g>
    <path data-part="pause" d="M10.5 9v6M13.5 9v6"/>
  </svg>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ playing?: boolean }>(), { playing: false });
</script>
