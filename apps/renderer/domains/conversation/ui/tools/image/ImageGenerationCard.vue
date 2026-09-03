<template>
  <!-- 图片生成卡直接作为根组件渲染，不再需要 ToolCallsMessage 的包裹。 -->
  <div class="image-generation-card">
    <!-- 直接复用现有的 ImageRenderer，保持逻辑一致性 -->
    <!-- 但我们在外层完全控制了它的容器，没有了边框和多余的 padding -->
    <ImageRenderer
      :images="presentation.data.images"
      :status="presentation.status"
    />
  </div>
</template>

<script setup lang="ts">
import ImageRenderer from './ImageRenderer.vue';
import type { ToolCardPresentation } from '../types';
import type { ImageGenerationPresentationData } from './definitions/imageGenerationPresentation';

// 定义符合 ToolUiConfig 组件接口的 props
defineProps<{
  presentation: ToolCardPresentation<ImageGenerationPresentationData>;
}>();
</script>
