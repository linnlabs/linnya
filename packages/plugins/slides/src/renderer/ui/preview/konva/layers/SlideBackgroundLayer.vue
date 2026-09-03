<template>
  <v-layer :config="layerConfig">
    <v-group :config="transform">
      <!-- 背景色矩形 -->
      <v-rect :config="bgRectConfig" />

      <!-- 背景图片（如有） -->
      <v-image
        v-if="props.imageResource"
        :config="bgImageConfig"
      />
    </v-group>
  </v-layer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SlideBackgroundModel } from '../../../../types/render';
import type { LoadedRenderImage } from '../../../../features/renderImageResources';
import {
  buildBackgroundImageConfig,
  buildBackgroundRectConfig,
} from '../../../../features/konvaPreview';

const props = defineProps<{
  background: SlideBackgroundModel;
  imageResource: LoadedRenderImage | null;
  logicalSize: { width: number; height: number };
  transform: { x: number; y: number; scaleX: number; scaleY: number };
}>();

/** 背景层不接受事件 */
const layerConfig = { listening: false };

/** 背景矩形配置 */
const bgRectConfig = computed(() => buildBackgroundRectConfig(props.background, props.logicalSize));

const bgImageConfig = computed(() => {
  if (!props.imageResource) return {};
  return {
    ...buildBackgroundImageConfig(props.logicalSize, props.imageResource.image),
    name: 'slide-background-image',
  };
});
</script>
