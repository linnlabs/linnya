<template>
  <SlideContentLayer
    v-if="preview.displayedSlide.value"
    :elements="preview.displayedSlide.value.elements"
    :image-resources="preview.imageResources.value"
    :chart-resources="preview.chartResources.value"
    :logical-size="logicalSize"
    :transform="transform"
  />
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useInsertionPreview, type EditingInsertionPreview } from '../../../../features/editingPreview';
import SlideContentLayer from './SlideContentLayer.vue';
const props = defineProps<{
  insertions: readonly EditingInsertionPreview[];
  logicalSize: { width: number; height: number };
  transform: { x: number; y: number; scaleX: number; scaleY: number };
}>();
const preview = useInsertionPreview(computed(() => props.insertions));
</script>
