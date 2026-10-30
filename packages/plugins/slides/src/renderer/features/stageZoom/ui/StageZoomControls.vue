<template>
  <div
    class="stage-zoom-controls"
    role="group"
    :aria-label="stageZoomMessage('slides.stageZoom.label')"
  >
    <button
      type="button"
      class="stage-zoom-controls__button"
      :disabled="zoomPercent <= STAGE_ZOOM_PERCENT_MIN"
      :aria-label="stageZoomMessage('slides.stageZoom.zoomOut')"
      :title="stageZoomMessage('slides.stageZoom.zoomOut')"
      @click="emit('setPercent', zoomPercent - STAGE_ZOOM_PERCENT_STEP)"
    >
      <SubtractIcon class="stage-zoom-controls__icon" />
    </button>
    <CustomSlider
      class="stage-zoom-controls__slider"
      variant="compact"
      :min="STAGE_ZOOM_PERCENT_MIN"
      :max="STAGE_ZOOM_PERCENT_MAX"
      :step="STAGE_ZOOM_PERCENT_SLIDER_STEP"
      :model-value="zoomPercent"
      :aria-label="stageZoomMessage('slides.stageZoom.slider')"
      @update:model-value="emit('setPercent', $event)"
    />
    <button
      type="button"
      class="stage-zoom-controls__button stage-zoom-controls__button--in"
      :disabled="zoomPercent >= STAGE_ZOOM_PERCENT_MAX"
      :aria-label="stageZoomMessage('slides.stageZoom.zoomIn')"
      :title="stageZoomMessage('slides.stageZoom.zoomIn')"
      @click="emit('setPercent', zoomPercent + STAGE_ZOOM_PERCENT_STEP)"
    >
      <AddIcon class="stage-zoom-controls__icon" />
    </button>
    <StageZoomMenu
      :zoom-percent="zoomPercent"
      :zoom-mode="zoomMode"
      @action="emit('action', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { CustomSlider } from '@linnya/renderer-ui';
import { AddIcon, SubtractIcon } from '@linnya/renderer-ui/icons';
import type { StageZoomMenuAction, StageZoomMode } from '../definitions/stageZoomTypes';
import {
  STAGE_ZOOM_PERCENT_MAX,
  STAGE_ZOOM_PERCENT_MIN,
  STAGE_ZOOM_PERCENT_SLIDER_STEP,
  STAGE_ZOOM_PERCENT_STEP,
} from '../functions/stageZoomPercent';
import StageZoomMenu from './StageZoomMenu.vue';
import { useStageZoomLocalization } from './useStageZoomLocalization';

defineProps<{
  zoomPercent: number;
  zoomMode: StageZoomMode;
}>();

/** 只发出目标百分比与菜单动作；夹取和写入 UI store 由调用方负责。 */
const emit = defineEmits<{
  setPercent: [percent: number];
  action: [action: StageZoomMenuAction];
}>();

const { stageZoomMessage } = useStageZoomLocalization();
</script>
