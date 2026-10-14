<template>
  <div class="stage-zoom-menu">
    <button
      ref="triggerRef"
      type="button"
      class="stage-zoom-menu__trigger"
      :class="{ 'stage-zoom-menu__trigger--open': open }"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="stageZoomMessage('slides.stageZoom.menu.label')"
      :title="stageZoomMessage('slides.stageZoom.menu.label')"
      @click="open = !open"
    >
      <span class="stage-zoom-menu__value">{{ zoomPercent }}%</span>
      <ChevronIcon
        class="stage-zoom-menu__chevron"
        direction="down"
      />
    </button>
    <div
      v-if="open"
      class="stage-zoom-menu__panel"
    >
      <CustomSelect
        :model-value="null"
        :options="options"
        :manual-mode="true"
        :parent-is-open="open"
        semantic-role="menu"
        variant="minimal"
        :bordered="false"
        :external-trigger-ref="triggerRef"
        options-motion-direction="up"
        :trigger-aria-label="stageZoomMessage('slides.stageZoom.menu.label')"
        min-width="128px"
        @update:model-value="select"
        @close="open = false"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { CustomSelect } from '@linnya/renderer-ui';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import type { StageZoomMenuAction, StageZoomMode } from '../definitions/stageZoomTypes';
import { buildStageZoomMenuOptions, resolveStageZoomMenuAction } from '../functions/stageZoomMenu';
import { useStageZoomLocalization } from './useStageZoomLocalization';

const props = defineProps<{
  zoomPercent: number;
  zoomMode: StageZoomMode;
}>();

const emit = defineEmits<{
  action: [action: StageZoomMenuAction];
}>();

const { stageZoomMessage } = useStageZoomLocalization();
const open = ref(false);
const triggerRef = ref<HTMLElement | null>(null);

const options = computed(() => buildStageZoomMenuOptions({
  zoomMode: props.zoomMode,
  zoomPercent: props.zoomPercent,
  fitLabel: stageZoomMessage('slides.stageZoom.fit'),
  formatPercent: percent => stageZoomMessage('slides.stageZoom.percent', { percent }),
}));

function select(value: string): void {
  open.value = false;
  const action = resolveStageZoomMenuAction(value);
  if (action) emit('action', action);
}
</script>
