<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';

/**
 * 候选组件原型：计划进入 renderer-ui 的 OverlayScrollArea。
 * 调用方只写 <OverlayScrollArea>内容</OverlayScrollArea>，不再各自手写三个 ref、init 与标记属性；
 * 需要滚动容器或手动刷新时通过 expose 取。底层仍是 useOverlayScrollViewport。
 */
interface OverlayScrollAreaProps {
  /** 横向：hidden 不滚动，scroll 可滚动。 */
  readonly overflowX?: 'hidden' | 'scroll';
  /** 纵向：hidden 不滚动，scroll 可滚动。 */
  readonly overflowY?: 'hidden' | 'scroll';
}

const props = withDefaults(defineProps<OverlayScrollAreaProps>(), {
  overflowX: 'hidden',
  overflowY: 'scroll',
});

const hostRef = ref<HTMLElement | null>(null);
const mountRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const overlayScroll = useOverlayScrollViewport({
  bindings: { hostRef, viewportMountRef: mountRef, viewportRef },
  options: { overflow: { x: props.overflowX, y: props.overflowY } },
});
onMounted(() => overlayScroll.init());

defineExpose({
  getViewport: overlayScroll.getViewport,
  scheduleUpdate: overlayScroll.scheduleUpdate,
});
</script>

<template>
  <div ref="hostRef" class="overlay-scroll-area" data-overlay-scroll-theme="linnya">
    <div ref="mountRef" class="overlay-scroll-area__mount" data-overlayscrollbars-initialize>
      <slot />
    </div>
  </div>
</template>

<style>
.overlay-scroll-area {
  min-height: 0;
}

.overlay-scroll-area__mount {
  height: 100%;
}
</style>
