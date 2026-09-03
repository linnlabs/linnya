<template>
  <div class="konva-slide-stage">
    <v-stage
      :config="stageConfig"
    >
      <!-- 背景层：不接受交互 -->
      <SlideBackgroundLayer
        :background="props.slideRender.background"
        :image-resource="backgroundImageResource"
        :logical-size="logicalSize"
        :transform="contentTransform"
      />

      <!-- 内容层：渲染所有元素 -->
      <SlideContentLayer
        :elements="props.slideRender.elements"
        :image-resources="props.imageResources"
        :chart-resources="props.chartResources"
        :logical-size="logicalSize"
        :transform="contentTransform"
      />

      <!-- Overlay 层：选中 / 诊断高亮（FE-K4 填充） -->
      <SlideOverlayLayer
        :transform="contentTransform"
        :selected-targets="props.selectedTargets"
        :hovered-target="props.hoveredTarget"
        :marquee-rect="props.marqueeRect"
      />
    </v-stage>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  useKonvaStage,
} from '../../../features/konvaPreview';
import type { RenderSlideSize, SlideRenderModel } from '../../../types/render';
import {
  SLIDE_BACKGROUND_IMAGE_RESOURCE_KEY,
  type SlideImageResourceMap,
} from '../../../features/renderImageResources';
import type { SlideChartResourceMap } from '../../../features/renderChartResources';
import type {
  SourceSelectableElement,
  SourceSelectionRect,
} from '../../../features/sourceSelection';
import SlideBackgroundLayer from './layers/SlideBackgroundLayer.vue';
import SlideContentLayer from './layers/SlideContentLayer.vue';
import SlideOverlayLayer from './layers/SlideOverlayLayer.vue';

const props = defineProps<{
  slideRender: SlideRenderModel;
  imageResources: SlideImageResourceMap;
  chartResources: SlideChartResourceMap;
  slideSize: RenderSlideSize;
  rasterScale: number;
  selectedTargets: readonly SourceSelectableElement[];
  hoveredTarget: SourceSelectableElement | null;
  marqueeRect: SourceSelectionRect | null;
}>();

const backgroundImageResource = computed(() => (
  props.imageResources.get(SLIDE_BACKGROUND_IMAGE_RESOURCE_KEY) ?? null
));

const slideSize = computed<RenderSlideSize>(() => props.slideSize);
const rasterScale = computed(() => props.rasterScale);

const {
  logicalSize,
  stageConfig,
  contentTransform,
} = useKonvaStage({
  slideSize,
  rasterScale,
});

</script>
