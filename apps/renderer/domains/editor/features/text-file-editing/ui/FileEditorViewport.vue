<template>
  <div
    ref="hostRef"
    class="text-file-editor"
    data-overlay-scroll-theme="linnya"
    data-overlay-scroll-visibility="strict-hover"
  >
    <div
      ref="viewportMountRef"
      class="text-file-editor-viewport"
      data-overlayscrollbars-initialize
    >
      <slot />
    </div>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';

const hostRef = ref<HTMLElement | null>(null);
const viewportMountRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const scroll = useOverlayScrollViewport({
  bindings: { hostRef, viewportMountRef, viewportRef },
  options: { overflow: { x: 'scroll', y: 'scroll' } },
});
onMounted(() => scroll.init());
</script>
