<template>
  <span
    class="canvas-color-swatch"
    :style="{
      backgroundColor: palette.paper,
      borderColor: `color-mix(in srgb, ${palette.title} 38%, transparent)`,
    }"
    aria-hidden="true"
  />
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { readCanvasCardCssPalette, type CanvasColor } from '@plugin/canvas/shared';
import { readCanvasIsDark } from '../../../functions/readCanvasAppearance';

/** 卡片纸色的真实样子；描边取同色相墨色，让很淡的染纸色在白底上也能分辨。 */
const props = defineProps<{ color: CanvasColor }>();
const palette = computed(() => readCanvasCardCssPalette(props.color, readCanvasIsDark()));
</script>
