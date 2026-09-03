<template>
  <label class="radio-item" :class="{ 'is-disabled': disabled }">
    <input 
      type="radio" 
      class="radio-input"
      :name="name" 
      :value="value"
      :checked="isChecked"
      :disabled="disabled"
      @change="handleChange" 
    />
    <span class="radio-custom"></span>
    <span class="radio-label">
      <slot></slot>
    </span>
  </label>
</template>

<script setup lang="ts" generic="T extends string | number | boolean">
import { computed } from 'vue';

const props = defineProps<{
  modelValue: T;
  value: T;
  name: string;
  disabled?: boolean;
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
