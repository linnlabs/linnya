<template>
  <div
    class="custom-number-input"
    :class="[
      `custom-number-input--${variant}`,
      {
        'custom-number-input--full-width': fullWidth,
      },
      rootClass,
    ]"
    :style="rootStyle"
  >
    <label
      v-if="label"
      class="input-label"
    >{{ label }}</label>
    <div
      class="input-wrapper"
      :class="{
        'input-wrapper--full-width': fullWidth,
      }"
    >
      <input
        ref="inputRef"
        type="number"
        :value="modelValue"
        :min="min"
        :max="max"
        :step="step"
        class="styled-input"
        :class="[
          `styled-input--${variant}`,
          `text-align-${align}`,
          {
            'styled-input--with-spin': showSpinButtons,
            'styled-input--full-width': fullWidth,
          },
          inputClass,
        ]"
        :style="inputStyle"
        v-bind="inputAttrs"
        @input="onInput"
      >
      <NumberSpinButtons
        v-if="showSpinButtons"
        :is-step-up-disabled="computedIsStepUpDisabled"
        :is-step-down-disabled="computedIsStepDownDisabled"
        :tab-index="spinButtonTabIndex"
        @step-up="$emit('step-up')"
        @step-down="$emit('step-down')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, normalizeClass, normalizeStyle, ref, useAttrs } from 'vue';
import type { CSSProperties } from 'vue';
import NumberSpinButtons from './NumberSpinButtons.vue';
import type { CustomNumberInputProps, NumberInputValue } from '../definitions/numberInput';

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(defineProps<CustomNumberInputProps>(), {
  label: '',
  inputWidth: undefined,
  min: undefined,
  max: undefined,
  step: 'any',
  variant: 'default',
  fullWidth: false,
  showSpinButtons: false,
  isStepUpDisabled: false,
  isStepDownDisabled: false,
  spinButtonTabIndex: -1,
  align: 'center',
  inputClass: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: NumberInputValue];
  'step-up': [];
  'step-down': [];
}>();
const attrs = useAttrs();
const inputRef = ref<HTMLInputElement | null>(null);

const rootClass = computed(() => normalizeClass(attrs.class));
const resolvedInputWidth = computed(() => {
  if (props.inputWidth === undefined || props.inputWidth === null || props.inputWidth === '') {
    return null;
  }

  return typeof props.inputWidth === 'number'
    ? `${props.inputWidth}px`
    : props.inputWidth;
});

const rootStyle = computed(() => normalizeStyle(attrs.style));
const inputStyle = computed<CSSProperties>(() => (
  resolvedInputWidth.value
    ? { width: resolvedInputWidth.value }
    : {}
));
const inputAttrs = computed(() => {
  const restAttrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key !== 'class' && key !== 'style') {
      restAttrs[key] = value;
    }
  }
  return restAttrs;
});

const numericValue = computed(() => {
  if (props.modelValue === '') {
    return Number.NaN;
  }
  return Number(props.modelValue);
});

const hasMin = computed(() => props.min !== undefined && props.min !== '');
const hasMax = computed(() => props.max !== undefined && props.max !== '');

const computedIsStepDownDisabled = computed(() => {
  if (props.isStepDownDisabled) return true;
  if (!hasMin.value || Number.isNaN(numericValue.value)) return false;
  return numericValue.value <= Number(props.min);
});

const computedIsStepUpDisabled = computed(() => {
  if (props.isStepUpDisabled) return true;
  if (!hasMax.value || Number.isNaN(numericValue.value)) return false;
  return numericValue.value >= Number(props.max);
});

const onInput = (event: Event): void => {
  if (!(event.target instanceof HTMLInputElement)) return;
  const value = event.target.value;
  // Use parseFloat to handle decimal steps
  const numberValue = parseFloat(value);
  emit('update:modelValue', Number.isNaN(numberValue) ? value : numberValue);
};

defineExpose({
  focus: () => inputRef.value?.focus(),
  select: () => inputRef.value?.select(),
  input: inputRef,
});
</script>
