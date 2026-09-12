<template>
  <v-group :__use-strict-mode="true" :config="previewTranslationConfig">
    <KonvaTextNode
      v-if="node.kind === 'text'"
      :node="node"
      :image-resources="props.imageResources"
    />
    <KonvaShapeNode
      v-else-if="node.kind === 'shape'"
      :node="node"
    />
    <KonvaImageNode
      v-else-if="node.kind === 'image'"
      :node="node"
      :image-resource="props.imageResources.get(node.id) ?? null"
    />
    <KonvaSvgGraphicNode
      v-else-if="node.kind === 'svgGraphic'"
      :node="node"
      :image-resource="props.imageResources.get(node.id) ?? null"
    />
    <KonvaFormulaNode
      v-else-if="node.kind === 'formula'"
      :node="node"
      :image-resource="props.imageResources.get(node.id) ?? null"
    />
    <KonvaTableNode
      v-else-if="node.kind === 'table'"
      :node="node"
    />
    <EChartsChartNode
      v-else-if="node.kind === 'chart'"
      :node="node"
      :chart-resource="props.chartResources.get(node.id) ?? null"
    />
    <KonvaGroupNode
      v-else
      :node="node"
      :image-resources="props.imageResources"
      :chart-resources="props.chartResources"
      :preview-translations="props.previewTranslations"
    />
  </v-group>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { RenderNode } from '../../../../types/render';
import type { SlideImageResourceMap } from '../../../../features/renderImageResources';
import type { SlideChartResourceMap } from '../../../../features/renderChartResources';
import EChartsChartNode from './EChartsChartNode.vue';
import KonvaGroupNode from './KonvaGroupNode.vue';
import KonvaImageNode from './KonvaImageNode.vue';
import KonvaShapeNode from './KonvaShapeNode.vue';
import KonvaSvgGraphicNode from './KonvaSvgGraphicNode.vue';
import KonvaFormulaNode from './KonvaFormulaNode.vue';
import KonvaTableNode from './KonvaTableNode.vue';
import KonvaTextNode from './KonvaTextNode.vue';
import { INCHES_TO_PX } from '../../../../shared/constants';
import type { ManualEditingTranslationPreview } from '../../../../features/manualEditing';

const props = defineProps<{
  node: RenderNode;
  imageResources: SlideImageResourceMap;
  chartResources: SlideChartResourceMap;
  previewTranslations?: ReadonlyMap<string, ManualEditingTranslationPreview>;
}>();

const previewTranslationConfig = computed(() => {
  const translation = props.previewTranslations?.get(props.node.id);
  return {
    x: (translation?.dx ?? 0) * INCHES_TO_PX,
    y: (translation?.dy ?? 0) * INCHES_TO_PX,
    listening: false,
  };
});
</script>
