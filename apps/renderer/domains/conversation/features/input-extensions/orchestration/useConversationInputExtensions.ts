import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import type { AnyExtension } from '@tiptap/core';
import type {
  ConversationInputChatExecutionSource,
  HostConversationInputExtension,
} from '../definitions/conversationInputExtensions';
import { createConversationInputEditorExtensions } from '../functions/createConversationInputEditorExtensions';
import { resolveActiveConversationInputExtension } from '../functions/resolveActiveConversationInputExtension';
import { resolveConversationInputExecution } from '../functions/resolveConversationInputExecution';
import { readConversationInputExtensions } from '../registry/conversationInputExtensionRegistry';

export function useActiveConversationInputExtension(): ComputedRef<HostConversationInputExtension | null> {
  return computed(() => resolveActiveConversationInputExtension(readConversationInputExtensions()));
}

export function createRegisteredConversationInputEditorExtensions(): AnyExtension[] {
  return createConversationInputEditorExtensions(readConversationInputExtensions());
}

export function useConversationInputExecution(chat: ConversationInputChatExecutionSource) {
  const activeExtension = useActiveConversationInputExtension();
  const resolvedExecution = computed(() => (
    resolveConversationInputExecution(chat, activeExtension.value)
  ));

  return {
    activeExtension,
    isLoading: computed(() => resolvedExecution.value.isLoading),
    isStreaming: computed(() => resolvedExecution.value.isStreaming),
    cancel: (): void => resolvedExecution.value.cancel(),
  };
}
