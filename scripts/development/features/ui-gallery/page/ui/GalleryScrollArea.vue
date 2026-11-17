<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';

/** 用产品同一套 OverlayScrollbars 接入方式渲染一段可滚动内容，便于看滚动条在各主题下的样子。 */
const hostRef = ref<HTMLElement | null>(null);
const mountRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const overlayScroll = useOverlayScrollViewport({
  bindings: { hostRef, viewportMountRef: mountRef, viewportRef },
  options: { overflow: { x: 'hidden', y: 'scroll' } },
});
onMounted(() => overlayScroll.init());
</script>

<template>
  <div ref="hostRef" class="gallery-scroll-area" data-overlay-scroll-theme="linnya">
    <div ref="mountRef" class="gallery-scroll-area__mount" data-overlayscrollbars-initialize>
      <slot />
    </div>
  </div>
</template>

<style>
.gallery-scroll-area {
  width: 280px; /* scale-exempt: 版面尺寸 */
  height: 160px; /* scale-exempt: 版面尺寸 */
  border-radius: var(--radius-md);
  background-color: var(--color-bg-surface);
  box-shadow: inset 0 0 0 var(--border-width-hairline) var(--color-border-light);
}

.gallery-scroll-area__mount {
  height: 100%;
}
</style>
