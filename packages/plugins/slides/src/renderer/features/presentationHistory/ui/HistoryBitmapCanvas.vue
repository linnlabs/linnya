<template>
  <canvas ref="canvas" class="slides-history-canvas" />
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps<{ bitmap: ImageBitmap | null }>();
const canvas = ref<HTMLCanvasElement | null>(null);
watch(
  [canvas, () => props.bitmap],
  ([element, bitmap]) => {
    if (!element) return;
    element.width = bitmap?.width ?? 0;
    element.height = bitmap?.height ?? 0;
    if (bitmap) element.getContext('2d')?.drawImage(bitmap, 0, 0);
  },
  { flush: 'post' }
);
// bitmap 的 ownership 在编排层；组件只释放自己的 canvas backing store。
onBeforeUnmount(() => {
  if (canvas.value) canvas.value.width = canvas.value.height = 0;
});
</script>
