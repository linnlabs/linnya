import type { BaseMessage } from '../../../types';
import type { ConversationMessageId } from '@app/schemas';

function collectMessageIds(messages: readonly BaseMessage[]): Set<ConversationMessageId> {
  const ids = new Set<ConversationMessageId>();
  for (const message of messages) {
    ids.add(message.id);
  }
  return ids;
}

export function createMessageEntryAnimationLedger(): {
  sync: (conversationId: string | null, messages: readonly BaseMessage[]) => Set<ConversationMessageId>;
  consume: (messageId: ConversationMessageId) => Set<ConversationMessageId>;
  reset: () => void;
} {
  let activeConversationId: string | null = null;
  let knownMessageIds = new Set<ConversationMessageId>();
  let pendingAnimationMessageIds = new Set<ConversationMessageId>();

  const getPendingSnapshot = (): Set<ConversationMessageId> => new Set(pendingAnimationMessageIds);

  const reset = () => {
    activeConversationId = null;
    knownMessageIds = new Set<ConversationMessageId>();
    pendingAnimationMessageIds = new Set<ConversationMessageId>();
  };

  const sync = (conversationId: string | null, messages: readonly BaseMessage[]): Set<ConversationMessageId> => {
    const nextMessageIds = collectMessageIds(messages);

    if (conversationId !== activeConversationId) {
      activeConversationId = conversationId;
      knownMessageIds = nextMessageIds;
      pendingAnimationMessageIds = new Set<ConversationMessageId>();
      return getPendingSnapshot();
    }

    for (const pendingId of pendingAnimationMessageIds) {
      if (!nextMessageIds.has(pendingId)) {
        pendingAnimationMessageIds.delete(pendingId);
      }
    }

    for (const messageId of nextMessageIds) {
      if (!knownMessageIds.has(messageId)) {
        pendingAnimationMessageIds.add(messageId);
      }
    }

    knownMessageIds = nextMessageIds;
    return getPendingSnapshot();
  };

  const consume = (messageId: ConversationMessageId): Set<ConversationMessageId> => {
    pendingAnimationMessageIds.delete(messageId);
    return getPendingSnapshot();
  };

  return {
    sync,
    consume,
    reset,
  };
}
