<template>
  <span
    class="secret-input"
    :class="[{ 'is-disabled': disabled }, rootClass]"
    :style="rootStyle"
  >
    <input
      ref="inputRef"
      class="secret-input__control"
      :type="visible ? 'text' : 'password'"
      :placeholder="placeholder"
      :disabled="disabled"
      :autocomplete="autocomplete"
      v-bind="inputAttrs"
      @input="handleInput"
    />
    <button
      class="secret-input__toggle"
      type="button"
      :disabled="disabled"
      :aria-label="visibilityLabel"
      :title="visibilityLabel"
      @click="toggleVisibility"
    >
      <SecretVisibilityIcon :visible="visible" />
    </button>
  </span>
</template>

<script setup lang="ts">
import { computed, normalizeClass, normalizeStyle, ref, useAttrs } from 'vue';
import { SecretVisibilityIcon } from '@linnya/renderer-ui/icons';
import { useSharedComponentLocalization } from '@linnya/renderer-ui/localization';

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(defineProps<{
  readonly modelValue?: string;
  readonly ephemeral?: boolean;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly autocomplete?: string;
  readonly showLabel?: string;
  readonly hideLabel?: string;
}>(), {
  placeholder: '',
  modelValue: '',
  ephemeral: false,
  disabled: false,
  autocomplete: 'off',
  showLabel: '',
  hideLabel: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const attrs = useAttrs();
const inputRef = ref<HTMLInputElement | null>(null);
const visible = ref(false);
const { sharedComponentMessage } = useSharedComponentLocalization();

const rootClass = computed(() => normalizeClass(attrs.class));
const rootStyle = computed(() => normalizeStyle(attrs.style));
const inputAttrs = computed(() => {
  const restAttrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key !== 'class' && key !== 'style') restAttrs[key] = value;
  }
  if (!props.ephemeral) restAttrs.value = props.modelValue;
  return restAttrs;
});
const visibilityLabel = computed(() => visible.value
  ? props.hideLabel || sharedComponentMessage('shared.secretInput.hide')
  : props.showLabel || sharedComponentMessage('shared.secretInput.show'));

function handleInput(event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return;
  if (props.ephemeral) return;
  emit('update:modelValue', event.target.value);
}

function toggleVisibility(): void {
  visible.value = !visible.value;
}

defineExpose({
  focus: () => inputRef.value?.focus(),
  select: () => inputRef.value?.select(),
  clear: () => {
    if (inputRef.value) inputRef.value.value = '';
  },
  takeValueAndClear: () => {
    const value = inputRef.value?.value ?? '';
    if (inputRef.value) inputRef.value.value = '';
    return value;
  },
});
</script>
