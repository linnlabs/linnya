<template>
  <span
    class="tt-text-field tt-text-field--textarea"
    :class="[
      `tt-text-field--${size}`,
      { 'tt-text-field--auto-grow': autoGrow },
      { 'tt-text-field--borderless': !bordered },
      rootClass,
    ]"
    :style="rootStyle"
  >
    <textarea
      ref="textareaRef"
      class="tt-text-field__control"
      :class="controlClass"
      :value="draftValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :rows="rows"
      v-bind="textareaAttrs"
      @input="handleInput"
      @change="handleChange"
    />
  </span>
</template>

<script setup lang="ts">
import { computed, nextTick, normalizeClass, normalizeStyle, onMounted, ref, useAttrs, watch } from 'vue';
import { applyTextareaAutoResize } from '../functions/applyTextareaAutoResize';

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(defineProps<{
  readonly modelValue: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly rows?: number | string;
  readonly size?: 'default' | 'compact';
  readonly autoGrow?: boolean;
  readonly autoGrowMinHeight?: number;
  readonly autoGrowMaxHeight?: number;
  readonly bordered?: boolean;
  /** 业务 owner 只能通过自己的 class 扩展原生 textarea，不得命中 package 内部 selector。 */
  readonly controlClass?: string;
}>(), {
  placeholder: '',
  disabled: false,
  rows: 3,
  size: 'default',
  autoGrow: false,
  autoGrowMinHeight: undefined,
  autoGrowMaxHeight: 160,
  bordered: true,
  controlClass: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'change-value': [value: string];
}>();

const attrs = useAttrs();
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const draftValue = ref(props.modelValue);

const rootClass = computed(() => normalizeClass(attrs.class));
const rootStyle = computed(() => normalizeStyle(attrs.style));
const textareaAttrs = computed(() => {
  const restAttrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key !== 'class' && key !== 'style') {
      restAttrs[key] = value;
    }
  }
  return restAttrs;
});

function handleInput(event: Event): void {
  if (!(event.target instanceof HTMLTextAreaElement)) return;
  draftValue.value = event.target.value;
  emit('update:modelValue', draftValue.value);
  adjustAutoGrowHeight(event.target);
}

function handleChange(event: Event): void {
  if (!(event.target instanceof HTMLTextAreaElement)) return;
  draftValue.value = event.target.value;
  emit('change-value', draftValue.value);
}

function adjustAutoGrowHeight(textarea = textareaRef.value): void {
  if (!props.autoGrow || !textarea) return;
  applyTextareaAutoResize(textarea, {
    minHeight: props.autoGrowMinHeight,
    maxHeight: props.autoGrowMaxHeight,
    scrollToBottomWhenCursorAtEnd: true,
  });
}

onMounted(() => {
  void nextTick(() => adjustAutoGrowHeight());
});

watch(
  () => props.modelValue,
  (nextValue) => {
    if (nextValue !== draftValue.value) {
      draftValue.value = nextValue;
    }
  },
);

watch(
  () => [draftValue.value, props.autoGrow, props.autoGrowMinHeight, props.autoGrowMaxHeight] as const,
  () => {
    void nextTick(() => adjustAutoGrowHeight());
  },
);

defineExpose({
  focus: () => textareaRef.value?.focus(),
  select: () => textareaRef.value?.select(),
});
</script>
