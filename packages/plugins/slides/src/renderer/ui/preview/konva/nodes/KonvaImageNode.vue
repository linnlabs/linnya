<template>
  <v-group
    :__use-strict-mode="true"
    :config="groupConfig"
  >
    <!-- 形状遮罩：遮罩路径 + 图片图案填充，阴影沿遮罩外轮廓。 -->
    <v-shape
      v-if="maskedConfig"
      :__use-strict-mode="true"
      :config="maskedConfig"
    />

    <!-- 只有资源明确加载失败时才会进入占位分支；加载中不会提交新页面。 -->
    <v-rect
      v-else-if="!props.imageResource"
      :__use-strict-mode="true"
      :config="placeholderConfig"
    />

    <!-- 图片加载成功后渲染 -->
    <v-image
      v-else
      :__use-strict-mode="true"
      :config="imageConfig"
    />
  </v-group>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ImageRenderNode } from '../../../../types/render';
import type { LoadedRenderImage } from '../../../../features/renderImageResources';
import {
  buildImageGroupConfig,
  buildImageNodeConfig,
  buildImagePlaceholderConfig,
  buildMaskedImageShapeConfig,
  resolveRenderImageMask,
} from '../../../../features/konvaPreview';

const props = defineProps<{
  node: ImageRenderNode;
  imageResource: LoadedRenderImage | null;
}>();

const groupConfig = computed(() => buildImageGroupConfig(props.node));

const imageConfig = computed(() => {
  if (!props.imageResource) return {};
  return buildImageNodeConfig(props.node, props.imageResource);
});

const placeholderConfig = computed(() => buildImagePlaceholderConfig(props.node));

const maskedConfig = computed(() => {
  const mask = resolveRenderImageMask(props.node);
  return mask ? buildMaskedImageShapeConfig(props.node, mask, props.imageResource) : null;
});
</script>
