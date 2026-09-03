<template>
  <button 
    :class="['toolbar-button', { 'is-disabled': disabled }]" 
    @click="handleClick"
    :disabled="disabled"
    :title="title"
  >
    <slot></slot>
  </button>
</template>

<script setup>
const props = defineProps({
  disabled: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['click']);

const handleClick = (event) => {
  if (!props.disabled) {
    emit('click', event);
  }
};
</script>
