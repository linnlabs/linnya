<template>
  <label class="radio-item" :class="[{ 'is-disabled': disabled }, classNames?.root]">
    <input 
      type="radio" 
      class="radio-input"
      :class="classNames?.control"
      :name="name" 
      :value="value"
      :checked="isChecked"
      :disabled="disabled"
      @change="handleChange" 
    />
    <span class="radio-custom" :class="classNames?.indicator"></span>
    <span class="radio-label" :class="classNames?.label">
      <slot></slot>
    </span>
  </label>
</template>

<script setup lang="ts" generic="T extends string | number | boolean">
import { computed } from 'vue';
import type { CustomRadioClassNames } from '../definitions/selectionClassNames';

const props = defineProps<{
  modelValue: T;
  value: T;
  name: string;
  disabled?: boolean;
  classNames?: CustomRadioClassNames;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: T];
}>();

const isChecked = computed(() => props.modelValue === props.value);

const handleChange = () => {
  if (!props.disabled) {
    emit('update:modelValue', props.value);
  }
};
</script>
