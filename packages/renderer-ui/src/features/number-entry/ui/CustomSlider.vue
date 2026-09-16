<template>
  <input
    type="range"
    class="linnya-ui-slider"
    :class="`linnya-ui-slider--${variant}`"
    :style="{ '--linnya-ui-slider-progress': `${progress}%` }"
    :value="modelValue"
    :min="min"
    :max="max"
    :step="step"
    :disabled="disabled"
    @input="onInput"
  >
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CustomSliderProps } from '../definitions/slider';
import { sliderProgress } from '../functions/sliderProgress';

const props = withDefaults(defineProps<CustomSliderProps>(), {
  min: 0,
  max: 100,
  step: 1,
  disabled: false,
  variant: 'default',
});
const emit = defineEmits<{ 'update:modelValue': [value: number] }>();
const progress = computed(() => sliderProgress(props.modelValue, props.min, props.max));

function onInput(event: Event): void {
  // 保留原生 range 的步进、指针捕获及键盘语义，不建立第二套手势或值状态。
  if (event.target instanceof HTMLInputElement) emit('update:modelValue', event.target.valueAsNumber);
}
</script>
