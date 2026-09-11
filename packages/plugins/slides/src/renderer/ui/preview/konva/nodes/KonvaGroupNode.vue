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

const props = defineProps<{
  node: GroupRenderNode;
  imageResources: SlideImageResourceMap;
  chartResources: SlideChartResourceMap;
}>();

const groupConfig = computed(() => buildGroupConfig(props.node));

const sortedChildren = computed(() =>
  sortNodesByZIndex(props.node.children),
);
</script>
