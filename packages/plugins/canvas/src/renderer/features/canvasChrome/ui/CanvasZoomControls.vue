<template>
  <!-- 与 Slides 底栏的舞台缩放同一组织：“− 百分比 +”，百分比菜单里先放适应视图，再放常用档位。 -->
  <div
    class="canvas-zoom-controls"
    role="group"
    :aria-label="t('canvas.zoom.group')"
    @pointerdown.stop
  >
    <ToolbarButton
      class="canvas-toolbar-button"
      :label="t('canvas.zoom.out')"
      :data-linnya-tooltip="`${t('canvas.zoom.out')} (⌘−)`"
      :disabled="zoom <= CANVAS_ZOOM_LIMITS.min"
      @click="emit('zoom', zoom / CANVAS_ZOOM_STEP)"
    >
      <SubtractIcon />
    </ToolbarButton>
    <CanvasToolbarMenu
      :label="t('canvas.zoom.level')"
      :options="options"
      :model-value="preset"
      min-width="160px"
      :show-selected-checkmark="true"
      align="end"
      class="canvas-zoom-menu"
      @select="choose"
    >
      <span class="canvas-zoom-value">{{ Math.round(zoom * 100) }}%</span>
    </CanvasToolbarMenu>
    <ToolbarButton
      class="canvas-toolbar-button"
      :label="t('canvas.zoom.in')"
      :data-linnya-tooltip="`${t('canvas.zoom.in')} (⌘+)`"
      :disabled="zoom >= CANVAS_ZOOM_LIMITS.max"
      @click="emit('zoom', zoom * CANVAS_ZOOM_STEP)"
    >
      <AddIcon />
    </ToolbarButton>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { ToolbarButton } from '@linnya/renderer-ui';
import { AddIcon, SubtractIcon } from '@linnya/renderer-ui/icons';
import {
  CANVAS_ZOOM_LIMITS,
  CANVAS_ZOOM_STEP,
  canvasZoomMenuOptions,
  canvasZoomPreset,
  type CanvasZoomMenuValue,
} from '../functions/canvasZoomMenu';
import { canvasText as t } from '../../localization';
import CanvasToolbarMenu from './CanvasToolbarMenu.vue';

/** 画布缩放：只发出目标倍率或“显示全部”，相机夹取与动画由页面编排。 */
const props = defineProps<{ zoom: number }>();
const emit = defineEmits<{ zoom: [value: number]; fit: [] }>();
const options = computed(() => canvasZoomMenuOptions());
const preset = computed(() => canvasZoomPreset(props.zoom));
function choose(value: CanvasZoomMenuValue) {
  if (value === 'fit') emit('fit');
  else emit('zoom', value);
}
</script>
