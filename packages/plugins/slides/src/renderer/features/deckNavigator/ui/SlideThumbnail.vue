<template>
  <div
    class="slide-thumbnail"
    :style="viewportStyle"
  >
    <!-- 同一份 ImageBitmap 服务页面条与平铺视图；canvas 按显示尺寸分配像素并高质量缩放。 -->
    <canvas
      v-if="bitmap"
      ref="canvasRef"
      class="slide-thumbnail-canvas"
      :width="canvasPixelWidth"
      :height="canvasPixelHeight"
    />
    <!-- 无缓存时保持稳定占位；缩略图只由 render-model/Konva 离屏生成。 -->
    <div
      v-else
      class="slide-thumbnail-placeholder"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { THUMBNAIL_PIXEL_RATIO } from '../../../shared/constants';

const props = defineProps<{
  /** 显示宽高（CSS px），由调用方按文稿比例给出 */
  width: number;
  height: number;
  /** 离屏生成的 ImageBitmap，由 thumbnailStore 提供 */
  bitmap?: ImageBitmap | null;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);

const viewportStyle = computed(() => ({
  width: `${props.width}px`,
  height: `${props.height}px`,
}));

const canvasPixelWidth = computed(() => Math.max(1, Math.round(props.width * THUMBNAIL_PIXEL_RATIO)));
const canvasPixelHeight = computed(() => Math.max(1, Math.round(props.height * THUMBNAIL_PIXEL_RATIO)));

/** bitmap 或显示尺寸变化时重画；改变 canvas 宽高会清空内容，所以两者共用一次绘制。 */
watch(
  () => [props.bitmap, canvasPixelWidth.value, canvasPixelHeight.value] as const,
  async ([bitmap]) => {
    if (!bitmap) return;
    await nextTick();
    const element = canvasRef.value;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.clearRect(0, 0, element.width, element.height);
    context.drawImage(bitmap, 0, 0, element.width, element.height);
  },
  { immediate: true },
);
</script>
