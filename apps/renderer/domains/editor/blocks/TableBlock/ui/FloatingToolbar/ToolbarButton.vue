<template>
  <button 
    :class="['toolbar-button', { 'is-disabled': disabled, 'is-danger': danger }]"
    @click="handleClick"
    :disabled="disabled"
    :data-linnya-tooltip="title"
    :aria-label="title"
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
  },
  /** 删除行、列等会去掉内容的操作：静止保持中性，悬停显示错误色（同 IconButton 的 danger）。 */
  danger: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['click']);

const handleClick = (event) => {
  if (!props.disabled) {
    emit('click', event);
  }
};
</script>
