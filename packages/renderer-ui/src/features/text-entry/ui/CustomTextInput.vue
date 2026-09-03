<template>
  <span
    class="tt-text-field"
    :class="[
      `tt-text-field--${size}`,
      { 'tt-text-field--borderless': !bordered },
      { 'tt-text-field--clearable': clearable },
      rootClass,
    ]"
    :style="rootStyle"
  >
    <input
      ref="inputRef"
      class="tt-text-field__control"
      :class="controlClass"
      :type="type"
      :value="draftValue"
      :placeholder="placeholder"
      :disabled="disabled"
      v-bind="inputAttrs"
      @input="handleInput"
      @change="handleChange"
    />
    <button
      v-if="clearable && draftValue && !disabled"
      type="button"
      class="tt-text-field__clear"
      :aria-label="clearLabel"
      :title="clearLabel"
      @mousedown.prevent
      @click="handleClear"
    >
      <CloseIcon />
    </button>
  </span>
</template>

<script setup lang="ts">
import { computed, normalizeClass, normalizeStyle, ref, useAttrs, watch } from 'vue';

import { CloseIcon } from '@linnya/renderer-ui/icons';
import { useSharedComponentLocalization } from '@linnya/renderer-ui/localization';

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<{
    readonly modelValue: string;
    readonly type?: 'text' | 'url' | 'email' | 'search' | 'password';
    readonly placeholder?: string;
    readonly disabled?: boolean;
    readonly size?: 'default' | 'compact';
    readonly bordered?: boolean;
    readonly clearable?: boolean;
    /** 业务 owner 只能通过自己的 class 扩展原生 input，不得命中 package 内部 selector。 */
    readonly controlClass?: string;
  }>(),
  {
    type: 'text',
    placeholder: '',
    disabled: false,
    size: 'default',
    bordered: true,
    clearable: false,
    controlClass: '',
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'change-value': [value: string];
}>();

const attrs = useAttrs();
const { sharedComponentMessage } = useSharedComponentLocalization();
const inputRef = ref<HTMLInputElement | null>(null);
const draftValue = ref(props.modelValue);
const clearLabel = computed(() => sharedComponentMessage('shared.textInput.clear'));

const rootClass = computed(() => normalizeClass(attrs.class));
const rootStyle = computed(() => normalizeStyle(attrs.style));
const inputAttrs = computed(() => {
  const restAttrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key !== 'class' && key !== 'style') {
      restAttrs[key] = value;
    }
  }
  return restAttrs;
});

function handleInput(event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return;
  draftValue.value = event.target.value;
  emit('update:modelValue', draftValue.value);
}

function handleChange(event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return;
  draftValue.value = event.target.value;
  emit('change-value', draftValue.value);
}

function handleClear(): void {
  draftValue.value = '';
  emit('update:modelValue', '');
  emit('change-value', '');
  inputRef.value?.focus();
}

watch(
  () => props.modelValue,
  nextValue => {
    if (nextValue !== draftValue.value) {
      draftValue.value = nextValue;
    }
  }
);

defineExpose({
  focus: () => inputRef.value?.focus(),
  select: () => inputRef.value?.select(),
});
</script>
