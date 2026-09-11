<template>
  <Teleport to="body">
    <Transition name="source-selection-prompt-pop">
      <form
        ref="formRef"
        v-if="position && targets.length > 0"
        class="source-selection-prompt"
        :class="`is-${position.placement}`"
        :style="promptStyle"
        @submit.prevent="submit"
        @pointerdown.stop
        @pointermove.stop
        @pointerup.stop
        @keydown.stop
      >
        <span class="source-selection-prompt__icon-mark">
          <LinnyaIcon class="source-selection-prompt__linnya-icon" />
        </span>
        <span class="source-selection-prompt__count">{{ targetLabel }}</span>
        <textarea
          ref="textareaRef"
          v-model="instruction"
          class="source-selection-prompt__textarea"
          autocomplete="off"
          :disabled="disabled"
          placeholder="随意修改..."
          rows="1"
          @input="resizeTextarea"
          @keydown="handleTextareaKeydown"
        />
        <span class="source-selection-prompt__buttons">
          <button
            class="source-selection-prompt__button source-selection-prompt__cancel"
            type="button"
            title="取消"
            aria-label="取消"
            @click="cancel"
          >
            <CloseIcon class="source-selection-prompt__icon" />
          </button>
          <button
            class="source-selection-prompt__button source-selection-prompt__submit"
            type="submit"
            :disabled="disabled || instruction.trim().length === 0"
            title="发送给 AI"
            aria-label="发送给 AI"
          >
            <EnterLeftIcon class="source-selection-prompt__icon" />
          </button>
        </span>
      </form>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { applyTextareaAutoResize } from '@linnya/renderer-ui';
import {
  CloseIcon,
  EnterLeftIcon,
  LinnyaIcon,
} from '@linnya/renderer-ui/icons';
import type {
  SourceSelectableElement,
  SourceSelectionPromptPosition,
} from '..';

const props = defineProps<{
  targets: readonly SourceSelectableElement[];
  position: SourceSelectionPromptPosition | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  submit: [instruction: string];
  cancel: [];
}>();

const instruction = ref('');
const formRef = ref<HTMLFormElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

const targetLabel = computed(() =>
  props.targets.length === 1 ? '1 个元素' : `${props.targets.length} 个元素`,
);
const isVisible = computed(() => props.position !== null && props.targets.length > 0);

const promptStyle = computed(() => {
  const position = props.position;
  if (!position) {
    return {};
  }
  return {
    left: `${position.leftPx}px`,
    top: `${position.topPx}px`,
  };
});

function submit(): void {
  const value = instruction.value.trim();
  if (props.disabled || value.length === 0) {
    return;
  }
  emit('submit', value);
  instruction.value = '';
}

function cancel(): void {
  instruction.value = '';
  emit('cancel');
}

function handleTextareaKeydown(event: KeyboardEvent): void {
  if (event.isComposing) {
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submit();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    cancel();
  }
}

function resizeTextarea(): void {
  const textarea = textareaRef.value;
  if (!textarea) {
    return;
  }
  applyTextareaAutoResize(textarea, { maxHeight: 92 });
}

function handleDocumentPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (target instanceof Node && formRef.value?.contains(target)) {
    return;
  }
  cancel();
}

watch(
  () => props.targets.map((target) => target.elementId).join('\u0000'),
  async (nextValue) => {
    if (!nextValue || props.disabled) {
      return;
    }
    await nextTick();
    textareaRef.value?.focus();
    resizeTextarea();
  },
  { immediate: true },
);

watch(
  isVisible,
  async (visible) => {
    if (!visible) {
      document.removeEventListener('pointerdown', handleDocumentPointerDown, { capture: true });
      return;
    }
    await nextTick();
    textareaRef.value?.focus();
    resizeTextarea();
    setTimeout(() => {
      document.addEventListener('pointerdown', handleDocumentPointerDown, { capture: true });
    }, 0);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown, { capture: true });
});
</script>
