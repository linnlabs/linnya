<template>
  <div 
    class="progress-container" 
    @click="$emit('seek', $event)"
    @mousedown="$emit('start-drag', $event)"
    ref="containerRef"
  >
    <div class="progress-bar" :style="{width: `${progress}%`}"></div>
    <div 
      class="progress-dot" 
      :style="{left: `${progress}%`}"
      @mousedown.stop="$emit('start-drag', $event)"
    ></div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

defineProps({
  progress: { type: Number, required: true },
});

defineEmits(['seek', 'start-drag']);

const containerRef = ref(null);

defineExpose({
  containerRef,
});
</script>
