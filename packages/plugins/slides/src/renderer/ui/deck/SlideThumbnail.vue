<template>
  <div
    class="slide-thumbnail"
    :style="viewportStyle"
  >
    <!-- 有 ImageBitmap 缓存时用 canvas 直接绘制 -->
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
import {
  THUMBNAIL_WIDTH,
  THUMBNAIL_PIXEL_RATIO,
} from '../../shared/constants';
import { resolveThumbnailHeightPx } from '../../shared/thumbnailGeometry';

const props = defineProps<{
  slideSize?: { width: number; height: number };
  /** 离屏生成的 ImageBitmap，由 thumbnailStore 提供 */
  bitmap?: ImageBitmap | null;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);

const thumbHeight = computed(() => resolveThumbnailHeightPx(props.slideSize));

const viewportStyle = computed(() => ({
  width: `${THUMBNAIL_WIDTH}px`,
  height: `${thumbHeight.value}px`,
}));

/** canvas 物理像素尺寸（与 ImageBitmap 对齐） */
const canvasPixelWidth = computed(() => THUMBNAIL_WIDTH * THUMBNAIL_PIXEL_RATIO);
const canvasPixelHeight = computed(() => thumbHeight.value * THUMBNAIL_PIXEL_RATIO);

/** bitmap 变化时画到 canvas 上 */
watch(
  () => props.bitmap,
  async (bmp) => {
    if (!bmp) return;
    await nextTick();
    const el = canvasRef.value;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.drawImage(bmp, 0, 0);
  },
  { immediate: true },
);
</script>
