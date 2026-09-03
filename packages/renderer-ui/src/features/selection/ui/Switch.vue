<!--
  packages/renderer-ui/src/features/selection/ui/Switch.vue

  跨业务通用开关控件。业务层负责决定能不能切换、切换后做什么；
  组件只表达 checkbox 语义和视觉状态，避免把业务规则塞进 shared。
-->
<template>
  <label class="switch-control" :class="{ 'is-disabled': disabled }">
    <span v-if="$slots.default" class="switch-control-label">
      <slot />
    </span>

    <input
      class="switch-control-input"
      type="checkbox"
      :checked="props.modelValue"
      :disabled="props.disabled"
      :aria-label="props.ariaLabel"
      @change="handleChange"
    />
    <span class="switch-control-track" aria-hidden="true">
      <span class="switch-control-thumb" />
    </span>
  </label>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean;
  ariaLabel: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

function handleChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  emit('update:modelValue', target.checked);
}
</script>
