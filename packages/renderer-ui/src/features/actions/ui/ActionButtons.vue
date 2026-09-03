<!-- packages/renderer-ui/src/features/actions/ui/ActionButtons.vue -->
<template>
  <div :class="['action-buttons-container', `action-buttons-container--${shape}`]">
    <button
      v-if="secondaryActionText || $slots['secondary-content']"
      v-show="showSecondaryAction"
      v-bind="secondaryButtonAttributes"
      type="button"
      :class="['action-btn', 'secondary', secondaryVariantClass]"
      :disabled="isSecondaryActionDisabled"
      @click="emit('secondary-click')"
    >
      <slot name="secondary-content">{{ secondaryActionText }}</slot>
    </button>
    <button
      v-if="primaryActionText || $slots['primary-content']"
      v-show="showPrimaryAction"
      v-bind="primaryButtonAttributes"
      type="button"
      :class="primaryButtonClasses"
      :disabled="isPrimaryActionDisabled"
      @click="emit('primary-click')"
    >
      <slot name="primary-content">{{ primaryActionText }}</slot>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type {
  ActionButtonsProps,
  ActionButtonsSlots,
} from '../definitions/actionButtons';

const props = withDefaults(defineProps<ActionButtonsProps>(), {
  primaryActionText: '',
  secondaryActionText: '',
  isPrimaryActionDisabled: false,
  isSecondaryActionDisabled: false,
  showPrimaryAction: true,
  showSecondaryAction: true,
  primaryVariant: 'default',
  secondaryVariant: 'filled',
  shape: 'default',
});

const secondaryVariantClass = computed(() => {
  if (props.secondaryVariant === 'ghost') {
    return 'secondary-ghost';
  }
  if (props.secondaryVariant === 'plain') {
    return 'secondary-plain';
  }
  // 默认 filled：直接使用 .secondary 基础样式
  return '';
});

const primaryButtonClasses = computed<readonly string[]>(() => {
  if (props.primaryVariant === 'danger') return ['action-btn', 'danger'];
  if (props.primaryVariant === 'accent') return ['action-btn', 'primary', 'accent'];
  return ['action-btn', 'primary'];
});

const emit = defineEmits<{
  'primary-click': [];
  'secondary-click': [];
}>();

defineSlots<ActionButtonsSlots>();
</script>
