<template>
  <v-group
    :__use-strict-mode="true"
    :config="groupConfig"
  >
    <!-- 文本框背景（调试用，后续可关闭） -->
    <v-text
      v-for="(line, idx) in flattenedLines"
      :key="idx"
      :__use-strict-mode="true"
      :config="line"
    />
    <v-image
      v-for="formula in inlineFormulaImages"
      :key="formula.key"
      :__use-strict-mode="true"
      :config="formula.config"
    />
  </v-group>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TextRenderNode } from '../../../../types/render';
import type { SlideImageResourceMap } from '../../../../features/renderImageResources';
import { buildTextGroupConfig, buildTextLineConfigs } from '../../../../features/konvaPreview';
import { buildInlineFormulaImageConfigs } from '../../../../features/formulaRendering';

const props = defineProps<{
  node: TextRenderNode;
  imageResources?: SlideImageResourceMap;
}>();

const emptyImageResources: SlideImageResourceMap = new Map();

const groupConfig = computed(() => buildTextGroupConfig(props.node));

const flattenedLines = computed(() => buildTextLineConfigs(props.node));
const inlineFormulaImages = computed(() => buildInlineFormulaImageConfigs(
  props.node,
  props.imageResources ?? emptyImageResources,
));
</script>
