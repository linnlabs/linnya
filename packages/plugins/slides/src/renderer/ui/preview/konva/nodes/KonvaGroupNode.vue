<template>
  <v-group
    :__use-strict-mode="true"
    :config="groupConfig"
  >
    <KonvaNodeRenderer
      v-for="child in sortedChildren"
      :key="child.id"
      :node="child"
      :image-resources="props.imageResources"
      :chart-resources="props.chartResources"
      :preview-translations="props.previewTranslations"
      :hidden-text-element-id="props.hiddenTextElementId"
      :manual-visual-preview="props.manualVisualPreview"
    />
  </v-group>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { GroupRenderNode } from '../../../../types/render';
import type { SlideImageResourceMap } from '../../../../features/renderImageResources';
import type { SlideChartResourceMap } from '../../../../features/renderChartResources';
import KonvaNodeRenderer from './KonvaNodeRenderer.vue';
import { buildGroupConfig, sortNodesByZIndex } from '../../../../features/konvaPreview';
import type {
  ManualEditingTranslationPreview,
  ManualEditingVisualPreview,
} from '../../../../features/manualEditing';

const props = defineProps<{
  node: GroupRenderNode;
  imageResources: SlideImageResourceMap;
  chartResources: SlideChartResourceMap;
  previewTranslations?: ReadonlyMap<string, ManualEditingTranslationPreview>;
  hiddenTextElementId?: string;
  manualVisualPreview?: ManualEditingVisualPreview | null;
}>();

const groupConfig = computed(() => buildGroupConfig(props.node));

const sortedChildren = computed(() =>
  sortNodesByZIndex(props.node.children),
);
</script>
