<template>
  <div class="checkbox-container" :class="classNames?.root">
    <label class="checkbox-item" :class="[{ 'disabled-label': disabled }, classNames?.item]">
      <input 
        type="checkbox"
        :checked="Array.isArray(modelValue) ? modelValue.includes(value) : modelValue"
        :value="value"
        @change="onChange"
        :disabled="disabled"
      >
      <span class="checkbox-custom" :class="classNames?.indicator">
        <OkIcon class="check-icon" :class="classNames?.checkIcon" />
      </span>
      <span class="label-content" :class="classNames?.label" v-if="$slots.default">
        <slot></slot>
      </span>
    </label>
    <div v-if="$slots.description" class="setting-description" :class="classNames?.description">
      <slot name="description"></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { OkIcon } from '@linnya/renderer-ui/icons';
import type { CustomCheckboxClassNames } from '../definitions/selectionClassNames';

interface Props {
  modelValue: boolean | Array<string | number | boolean>;
  value?: string | number | boolean;
  disabled?: boolean;
  classNames?: CustomCheckboxClassNames;
}

const props = withDefaults(defineProps<Props>(), {
  value: true,
  disabled: false,
  classNames: undefined,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean | Array<string | number | boolean>): void;
}>();

const onChange = (event: Event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  if (Array.isArray(props.modelValue)) {
    const newValue = [...props.modelValue];
    const valueToToggle = props.value;
    if (target.checked) {
      if (!newValue.includes(valueToToggle)) {
        newValue.push(valueToToggle);
      }
    } else {
      const index = newValue.indexOf(valueToToggle);
      if (index > -1) {
        newValue.splice(index, 1);
      }
    }
    emit('update:modelValue', newValue);
  } else {
    emit('update:modelValue', target.checked);
  }
};
</script>
