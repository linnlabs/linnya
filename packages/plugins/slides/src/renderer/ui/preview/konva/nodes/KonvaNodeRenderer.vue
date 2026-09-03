<template>
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
  />
</template>

<script setup lang="ts">
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

const props = defineProps<{
  node: RenderNode;
  imageResources: SlideImageResourceMap;
  chartResources: SlideChartResourceMap;
}>();
</script>
