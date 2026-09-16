<template>
  <v-group :__use-strict-mode="true" :config="previewTranslationConfig">
    <KonvaTextNode
      v-if="renderNode.kind === 'text'"
      :node="renderNode"
      :image-resources="props.imageResources"
    />
    <KonvaShapeNode
      v-else-if="renderNode.kind === 'shape'"
      :node="renderNode"
      :hide-text="props.node.id === props.hiddenTextElementId"
    />
    <KonvaImageNode
      v-else-if="renderNode.kind === 'image'"
      :node="renderNode"
      :image-resource="props.imageResources.get(node.id) ?? null"
    />
    <KonvaSvgGraphicNode
      v-else-if="renderNode.kind === 'svgGraphic'"
      :node="renderNode"
      :image-resource="props.imageResources.get(node.id) ?? null"
    />
    <KonvaFormulaNode
      v-else-if="renderNode.kind === 'formula'"
      :node="renderNode"
      :image-resource="props.imageResources.get(node.id) ?? null"
    />
    <KonvaTableNode
      v-else-if="renderNode.kind === 'table'"
      :node="renderNode"
    />
    <EChartsChartNode
      v-else-if="renderNode.kind === 'chart'"
      :node="renderNode"
      :chart-resource="props.chartResources.get(node.id) ?? null"
    />
    <KonvaGroupNode
      v-else
      :node="renderNode"
      :image-resources="props.imageResources"
      :chart-resources="props.chartResources"
      :preview-translations="props.previewTranslations"
      :hidden-text-element-id="props.hiddenTextElementId"
      :manual-visual-previews="props.manualVisualPreviews"
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
import {
  projectManualVisualPreviewsToRenderNode,
  type ManualEditingVisualPreview,
} from '../../../../features/manualEditing/manualVisualProjection';
import type { ManualEditingTranslationPreview } from '../../../../features/manualEditing';

const props = defineProps<{
  node: RenderNode;
  imageResources: SlideImageResourceMap;
  chartResources: SlideChartResourceMap;
  previewTranslations?: ReadonlyMap<string, ManualEditingTranslationPreview>;
  hiddenTextElementId?: string;
  manualVisualPreviews?: readonly ManualEditingVisualPreview[];
}>();

const renderNode = computed(() => projectManualVisualPreviewsToRenderNode(
  props.node,
  props.manualVisualPreviews ?? [],
));

const previewTranslationConfig = computed(() => {
  const translation = props.previewTranslations?.get(props.node.id);
  return {
    x: (translation?.dx ?? 0) * INCHES_TO_PX,
    y: (translation?.dy ?? 0) * INCHES_TO_PX,
    listening: false,
    visible: props.node.kind !== 'text' || props.node.id !== props.hiddenTextElementId,
  };
});
</script>
