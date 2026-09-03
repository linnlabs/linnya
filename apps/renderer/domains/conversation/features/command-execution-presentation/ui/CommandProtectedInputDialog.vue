<template>
  <Modal
    :is-visible="visible"
    :title="conversationMessage('conversation.tool.command.protectedInput.title')"
    width="440px"
    max-width="calc(100vw - 32px)"
    scroll-mode="content"
    :close-on-overlay-click="!submitting"
    :close-on-esc="!submitting"
    @close="close"
  >
    <form
      id="command-protected-input-form"
      class="command-protected-input"
      @submit.prevent="submit"
    >
      <p class="command-protected-input__description">
        {{ conversationMessage('conversation.tool.command.protectedInput.description') }}
      </p>
      <div class="command-protected-input__target">
        {{ command }}
      </div>
      <label class="command-protected-input__label">
        <span>{{ conversationMessage('conversation.tool.command.protectedInput.label') }}</span>
        <SecretInput
          ref="inputElement"
          ephemeral
          class="command-protected-input__field"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          :disabled="submitting"
        />
      </label>
      <p class="command-protected-input__boundary">
        {{ conversationMessage('conversation.tool.command.protectedInput.boundary') }}
      </p>
      <p
        v-if="errorText"
        class="command-protected-input__error"
      >
        {{ errorText }}
      </p>
    </form>

    <template #footer>
      <div class="command-protected-input__actions">
        <button
          type="button"
          class="command-protected-input__button is-secondary"
          :disabled="submitting"
          @click="close"
        >
          {{ conversationMessage('conversation.tool.command.protectedInput.cancel') }}
        </button>
        <button
          type="submit"
          form="command-protected-input-form"
          class="command-protected-input__button is-primary"
          :disabled="submitting"
        >
          {{ submitting
            ? conversationMessage('conversation.tool.command.protectedInput.sending')
            : conversationMessage('conversation.tool.command.protectedInput.send') }}
        </button>
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

import { Modal, SecretInput } from '@linnya/renderer-ui';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import './CommandProtectedInputDialog.css';

const props = defineProps<{
  readonly visible: boolean;
  readonly command: string;
  readonly submitting: boolean;
  readonly errorText: string;
}>();
const emit = defineEmits<{
  close: [];
  submit: [value: string];
}>();
const { conversationMessage } = useConversationLocalization();
const inputElement = ref<InstanceType<typeof SecretInput>>();

watch(
  () => props.visible,
  async (visible) => {
    inputElement.value?.clear();
    if (!visible) return;
    await nextTick();
    inputElement.value?.focus();
  },
);

function close(): void {
  if (props.submitting) return;
  inputElement.value?.clear();
  emit('close');
}

function submit(): void {
  if (props.submitting) return;
  // DOM 是提交前唯一的短暂明文持有者；读取动作同时清空，不进入 Vue 响应式状态。
  const submitted = inputElement.value?.takeValueAndClear() ?? '';
  emit('submit', submitted);
}
</script>
