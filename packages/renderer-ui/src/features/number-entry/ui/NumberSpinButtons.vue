<template>
  <div class="number-spin-buttons">
    <button
      type="button"
      class="spin-btn up"
      :disabled="isStepUpDisabled"
      :tabindex="tabIndex"
      :aria-label="resolvedUpAriaLabel"
      @click.stop.prevent="$emit('step-up')"
      @mousedown.left="startSpin('up')"
      @mouseup="stopSpin"
      @mouseleave="stopSpin"
    >
      <ChevronIcon direction="up" />
    </button>
    <button
      type="button"
      class="spin-btn down"
      :disabled="isStepDownDisabled"
      :tabindex="tabIndex"
      :aria-label="resolvedDownAriaLabel"
      @click.stop.prevent="$emit('step-down')"
      @mousedown.left="startSpin('down')"
      @mouseup="stopSpin"
      @mouseleave="stopSpin"
    >
      <ChevronIcon direction="down" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { useSharedComponentLocalization } from '@linnya/renderer-ui/localization';

const props = withDefaults(defineProps<{
  readonly isStepUpDisabled?: boolean;
  readonly isStepDownDisabled?: boolean;
  readonly tabIndex?: number;
  readonly upAriaLabel?: string;
  readonly downAriaLabel?: string;
}>(), {
  isStepUpDisabled: false,
  isStepDownDisabled: false,
  tabIndex: -1,
  upAriaLabel: '',
  downAriaLabel: '',
});

const emit = defineEmits<{
  'step-up': [];
  'step-down': [];
}>();
const { sharedComponentMessage } = useSharedComponentLocalization();
const resolvedUpAriaLabel = computed(() => (
  props.upAriaLabel || sharedComponentMessage('shared.numberSpin.stepUp')
));
const resolvedDownAriaLabel = computed(() => (
  props.downAriaLabel || sharedComponentMessage('shared.numberSpin.stepDown')
));

let timeoutId: ReturnType<typeof setTimeout> | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

const startSpin = (direction: 'up' | 'down'): void => {
  stopSpin();
  
  timeoutId = setTimeout(() => {
    intervalId = setInterval(() => {
      if (direction === 'up' && props.isStepUpDisabled) {
        stopSpin();
        return;
      }
      if (direction === 'down' && props.isStepDownDisabled) {
        stopSpin();
        return;
      }
      if (direction === 'up') {
        emit('step-up');
      } else {
        emit('step-down');
      }
    }, 50); // 每 50ms 触发一次
  }, 300); // 长按 300ms 后开始连续触发
};

const stopSpin = (): void => {
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
};
</script>
