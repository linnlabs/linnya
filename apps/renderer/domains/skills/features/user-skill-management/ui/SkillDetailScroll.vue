<template>
  <div
    ref="hostRef"
    class="skills-detail-scroll"
    data-overlay-scroll-theme="linnya"
    data-overlay-scroll-visibility="strict-hover"
  >
    <div
      ref="viewportMountRef"
      class="skills-detail-scroll-viewport"
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
const scroll = useOverlayScrollViewport({ bindings: { hostRef, viewportMountRef, viewportRef } });
onMounted(() => scroll.init());
</script>
