<template>
  <v-group :config="groupConfig">
    <v-rect
      v-if="!props.imageResource"
      :config="placeholderConfig"
    />
    <v-image
      v-else
      :config="imageConfig"
    />
  </v-group>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SvgGraphicRenderNode } from '../../../../types/render';
import type { LoadedRenderImage } from '../../../../features/renderImageResources';
import {
  buildSvgGraphicGroupConfig,
  buildSvgGraphicImageConfig,
  buildSvgGraphicPlaceholderConfig,
} from '../../../../features/svgGraphicRendering';

const props = defineProps<{
  node: SvgGraphicRenderNode;
  imageResource: LoadedRenderImage | null;
}>();

const groupConfig = computed(() => buildSvgGraphicGroupConfig(props.node));
const imageConfig = computed(() => props.imageResource
  ? buildSvgGraphicImageConfig(props.node, props.imageResource)
  : {});
const placeholderConfig = computed(() => buildSvgGraphicPlaceholderConfig(props.node));
</script>
