<template>
  <v-group
    :__use-strict-mode="true"
    :config="groupConfig"
  >
    <!-- 只有资源明确加载失败时才会进入占位分支；加载中不会提交新页面。 -->
    <v-rect
      v-if="!props.imageResource"
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
</script>
