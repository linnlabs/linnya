<template>
  <v-layer>
    <v-group :config="transform">
      <KonvaNodeRenderer
        v-for="node in sortedElements"
        :key="node.id"
        :node="node"
        :image-resources="props.imageResources"
        :chart-resources="props.chartResources"
      />
    </v-group>
  </v-layer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { RenderNode } from '../../../../types/render';
import type { SlideImageResourceMap } from '../../../../features/renderImageResources';
import type { SlideChartResourceMap } from '../../../../features/renderChartResources';
import KonvaNodeRenderer from '../nodes/KonvaNodeRenderer.vue';
import { sortNodesByZIndex } from '../../../../features/konvaPreview';

const props = defineProps<{
  elements: RenderNode[];
  imageResources: SlideImageResourceMap;
  chartResources: SlideChartResourceMap;
  logicalSize: { width: number; height: number };
  transform: { x: number; y: number; scaleX: number; scaleY: number };
}>();

const sortedElements = computed(() =>
  sortNodesByZIndex(props.elements),
);
</script>
