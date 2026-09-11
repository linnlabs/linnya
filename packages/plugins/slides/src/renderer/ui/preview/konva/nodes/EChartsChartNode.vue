<template>
  <v-image
    v-if="props.chartResource"
    :__use-strict-mode="true"
    :config="imageConfig"
  />
  <v-rect
    v-else
    :__use-strict-mode="true"
    :config="placeholderConfig"
  />
</template>

<script setup lang="ts">
/**
 * ECharts 图表节点
 *
 * 这里只消费 renderChartResources 已经完成的 PNG；组件禁止启动异步渲染，
 * 否则切页重挂载会先画透明占位，再替换图片而产生闪烁。
 */
import { computed } from 'vue';
import type { ChartRenderNode } from '../../../../types/render';
import type { LoadedRenderChart } from '../../../../features/renderChartResources';
import {
  buildChartImageConfig,
  buildChartPlaceholderConfig,
} from '../../../../features/konvaPreview';

const props = defineProps<{
  node: ChartRenderNode;
  chartResource: LoadedRenderChart | null;
}>();

const imageConfig = computed(() => (
  props.chartResource
    ? buildChartImageConfig(props.node, props.chartResource.image)
    : {}
));

const placeholderConfig = computed(() => buildChartPlaceholderConfig(props.node));
</script>
