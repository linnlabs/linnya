<!--
 * packages/plugins/canvas/src/renderer/icon/LineIcon.vue
 * “线条（箭头与线型）”图标组件。
-->
<template>
  <svg
    class="linnya-ui-icon"
    data-icon="line"
    :data-state="props.dashed ? 'dashed-' + props.arrows : props.arrows"
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
    <path
      v-if="(props.dashed ? 'dashed-' + props.arrows : props.arrows) === 'none'"
      d="M4.5 11.5H19.5"
    />
    <path
      v-if="(props.dashed ? 'dashed-' + props.arrows : props.arrows) === 'end'"
      d="M4.5 11.5H19.5M16 8l3.5 3.5L16 15"
    />
    <path
      v-if="(props.dashed ? 'dashed-' + props.arrows : props.arrows) === 'both'"
      d="M4.5 11.5H19.5M16 8l3.5 3.5L16 15M8 8l-3.5 3.5L8 15"
    />
    <path
      v-if="(props.dashed ? 'dashed-' + props.arrows : props.arrows) === 'dashed-none'"
      d="M4.5 11.5h3M10.5 11.5h3M16.5 11.5h3"
    />
    <path
      v-if="(props.dashed ? 'dashed-' + props.arrows : props.arrows) === 'dashed-end'"
      d="M4.5 11.5h3M10.5 11.5h3M16.5 11.5h3M16 8l3.5 3.5L16 15"
    />
    <path
      v-if="(props.dashed ? 'dashed-' + props.arrows : props.arrows) === 'dashed-both'"
      d="M4.5 11.5h3M10.5 11.5h3M16.5 11.5h3M16 8l3.5 3.5L16 15M8 8l-3.5 3.5L8 15"
    />
  </svg>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ arrows?: 'none' | 'end' | 'both'; dashed?: boolean }>(), {
  arrows: 'none',
  dashed: false,
});
</script>
