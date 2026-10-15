<!-- packages/renderer-ui/src/features/actions/ui/ActionButtons.vue -->
<template>
  <div :class="['action-buttons-container', `action-buttons-container--${shape}`]">
    <BaseButton
      v-if="secondaryActionText || $slots['secondary-content']"
      v-show="showSecondaryAction"
      v-bind="secondaryButtonAttributes"
      :variant="secondaryButtonVariant"
      :shape="buttonShape"
      :disabled="isSecondaryActionDisabled"
      @click="emit('secondary-click')"
    >
      <slot name="secondary-content">{{ secondaryActionText }}</slot>
    </BaseButton>
    <BaseButton
      v-if="primaryActionText || $slots['primary-content']"
      v-show="showPrimaryAction"
      v-bind="primaryButtonAttributes"
      :variant="primaryButtonVariant"
      :shape="buttonShape"
      :disabled="isPrimaryActionDisabled"
      @click="emit('primary-click')"
    >
      <slot name="primary-content">{{ primaryActionText }}</slot>
    </BaseButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import BaseButton from './BaseButton.vue';
import type {
  ActionButtonsProps,
  ActionButtonsSlots,
} from '../definitions/actionButtons';
import type { BaseButtonShape, BaseButtonVariant } from '../definitions/baseButton';

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

const PRIMARY_BUTTON_VARIANT = {
  default: 'primary',
  danger: 'danger',
  accent: 'soft',
} as const satisfies Record<NonNullable<ActionButtonsProps['primaryVariant']>, BaseButtonVariant>;

const SECONDARY_BUTTON_VARIANT = {
  filled: 'secondary',
  ghost: 'ghost',
  plain: 'plain',
} as const satisfies Record<NonNullable<ActionButtonsProps['secondaryVariant']>, BaseButtonVariant>;

const primaryButtonVariant = computed<BaseButtonVariant>(() => PRIMARY_BUTTON_VARIANT[props.primaryVariant]);
const secondaryButtonVariant = computed<BaseButtonVariant>(() => SECONDARY_BUTTON_VARIANT[props.secondaryVariant]);
const buttonShape = computed<BaseButtonShape>(() => (props.shape === 'pill' ? 'pill' : 'default'));

const emit = defineEmits<{
  'primary-click': [];
  'secondary-click': [];
}>();

defineSlots<ActionButtonsSlots>();
</script>
