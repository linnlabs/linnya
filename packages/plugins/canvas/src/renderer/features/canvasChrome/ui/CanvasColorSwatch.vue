<template>
  <span class="canvas-color-swatch" :style="swatch" aria-hidden="true" />
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef } from 'vue';
import { RENDERER_UI_THEME_ATTRIBUTE } from '@linnya/renderer-ui/theme';
import type { CanvasColor } from '@plugin/canvas/shared';
import { readCanvasSwatchStyle } from '../functions/readCanvasSwatchStyle';
import { readCanvasIsDark } from '../../../functions/readCanvasAppearance';

const props = defineProps<{ color: CanvasColor }>();
// 工具条上的色块在选中期间常驻；切换主题时要跟着换，不能停在挂载时的主题。
const dark = shallowRef(readCanvasIsDark());
const theme = new MutationObserver(() => {
  dark.value = readCanvasIsDark();
});
theme.observe(document.documentElement, {
  attributes: true,
  attributeFilter: [RENDERER_UI_THEME_ATTRIBUTE],
});
onBeforeUnmount(() => theme.disconnect());
const swatch = computed(() => readCanvasSwatchStyle(props.color, dark.value));
</script>
