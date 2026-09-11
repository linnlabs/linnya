<template>
  <v-layer
    :__use-strict-mode="true"
    :config="layerConfig"
  >
    <v-group
      :__use-strict-mode="true"
      :config="transform"
    >
      <!-- 配置是唯一事实：strict 模式会恢复切换 Paint 类型时已被删除、但仍留在绑定器旧缓存中的属性。 -->
      <v-rect
        :__use-strict-mode="true"
        :config="bgRectConfig"
      />

      <!-- 背景图片（如有） -->
      <v-image
        v-if="props.imageResource"
        :__use-strict-mode="true"
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
