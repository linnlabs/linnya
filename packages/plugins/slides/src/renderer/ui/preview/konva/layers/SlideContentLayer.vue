<template>
  <v-layer :__use-strict-mode="true">
    <v-group
      :__use-strict-mode="true"
      :config="transform"
    >
      <KonvaNodeRenderer
        v-for="node in sortedElements"
        :key="node.id"
        :node="node"
        :image-resources="props.imageResources"
        :chart-resources="props.chartResources"
        :preview-translations="props.previewTranslations"
        :hidden-text-element-ids="props.hiddenTextElementIds"
        :manual-visual-previews="props.manualVisualPreviews"
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
import type {
  ManualEditingTranslationPreview,
  ManualEditingVisualPreview,
} from '../../../../features/manualEditing';

const props = defineProps<{
  elements: RenderNode[];
  imageResources: SlideImageResourceMap;
  chartResources: SlideChartResourceMap;
  logicalSize: { width: number; height: number };
  transform: { x: number; y: number; scaleX: number; scaleY: number };
  previewTranslations?: ReadonlyMap<string, ManualEditingTranslationPreview>;
  hiddenTextElementIds?: ReadonlySet<string>;
  manualVisualPreviews?: readonly ManualEditingVisualPreview[];
}>();

const sortedElements = computed(() =>
  sortNodesByZIndex(props.elements),
);
</script>
