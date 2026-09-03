import { ref, watch, type ComputedRef } from 'vue';
import type { ConversationMessageId } from '@app/schemas';
import type { MessageEntryAnimationPort } from '../../../definitions/messageEntryAnimation';
import type { BaseMessage } from '../../../types';
import { createMessageEntryAnimationLedger } from '../logic/messageEntryAnimationLedger';

export function useMessageEntryAnimation(params: {
  conversationId: ComputedRef<string | null>;
  messages: ComputedRef<BaseMessage[]>;
}) {
  const { conversationId, messages } = params;
  const ledger = createMessageEntryAnimationLedger();
  const pendingEntryAnimationMessageIds = ref(new Set<ConversationMessageId>());

  const syncPendingMessageIds = () => {
    pendingEntryAnimationMessageIds.value = ledger.sync(
      conversationId.value,
      messages.value
    );
  };

  const consumeEntryAnimation = (messageId: ConversationMessageId) => {
    pendingEntryAnimationMessageIds.value = ledger.consume(messageId);
  };

  const port: MessageEntryAnimationPort = {
    isPending: messageId => pendingEntryAnimationMessageIds.value.has(messageId),
    consume: consumeEntryAnimation,
  };

  watch(
    () => [conversationId.value, messages.value] as const,
    () => {
      syncPendingMessageIds();
    },
    { immediate: true, deep: false }
  );

  return {
    port,
  };
}
