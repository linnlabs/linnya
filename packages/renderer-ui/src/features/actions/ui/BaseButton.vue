<!-- packages/renderer-ui/src/features/actions/ui/BaseButton.vue -->
<template>
  <button :type="type" :disabled="disabled" :class="classes">
    <span v-if="$slots.icon" class="linnya-ui-button__icon" aria-hidden="true">
      <slot name="icon" />
    </span>
    <span class="linnya-ui-button__label">
      <slot />
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed, useSlots } from 'vue';
import type { BaseButtonProps, BaseButtonSlots, BaseButtonVariant } from '../definitions/baseButton';

const props = withDefaults(defineProps<BaseButtonProps>(), {
  variant: 'secondary',
  tone: 'neutral',
  size: 'sm',
  shape: 'default',
  block: false,
  disabled: false,
  type: 'button',
});

defineSlots<BaseButtonSlots>();
const TONED_VARIANTS: ReadonlySet<BaseButtonVariant> = new Set<BaseButtonVariant>(['outline', 'plain']);
const slots = useSlots();
/** soft 已并入 tint（3.6.0），已发布插件仍可能传 soft，按 tint 渲染。 */
const renderedVariant = computed<BaseButtonVariant>(() => (props.variant === 'soft' ? 'tint' : props.variant));

const classes = computed<readonly string[]>(() => [
  'linnya-ui-button',
  `linnya-ui-button--${renderedVariant.value}`,
  `linnya-ui-button--${props.size}`,
  ...(TONED_VARIANTS.has(props.variant) ? [`linnya-ui-button--tone-${props.tone}`] : []),
  ...(props.shape === 'pill' ? ['linnya-ui-button--pill'] : []),
  ...(props.block ? ['linnya-ui-button--block'] : []),
  ...(slots.icon ? ['linnya-ui-button--with-icon'] : []),
]);
</script>
