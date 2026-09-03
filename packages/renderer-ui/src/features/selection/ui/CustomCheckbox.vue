<template>
  <div class="checkbox-container">
    <label class="checkbox-item" :class="{ 'disabled-label': disabled }">
      <input 
        type="checkbox"
        :checked="Array.isArray(modelValue) ? modelValue.includes(value) : modelValue"
        :value="value"
        @change="onChange"
        :disabled="disabled"
      >
      <span class="checkbox-custom">
        <OkIcon class="check-icon" />
      </span>
      <span class="label-content" v-if="$slots.default">
        <slot></slot>
      </span>
    </label>
    <div v-if="$slots.description" class="setting-description">
      <slot name="description"></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { OkIcon } from '@linnya/renderer-ui/icons';

interface Props {
  modelValue: boolean | Array<string | number | boolean>;
  value?: string | number | boolean;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  value: true,
  disabled: false
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
