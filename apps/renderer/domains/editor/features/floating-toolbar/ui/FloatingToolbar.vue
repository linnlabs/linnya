<template>
  <div
    v-if="show"
    class="floating-toolbar"
    :style="toolbarStyle"
    @mousedown.prevent
  >
    <slot></slot>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  position: {
    type: Object,
    default: () => ({ top: 0, left: 0 }), // { top: number, left: number }
  },
});

const toolbarStyle = computed(() => {
  const x = props.position?.left || 0;
  const y = props.position?.top || 0;
  return {
    top: `${y}px`,
    left: `${x}px`,
  };
});
</script>
