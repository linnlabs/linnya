import { useConversationState } from '../store/conversationState';
import { installLongTaskObserver } from '../shared/observability/installLongTaskObserver';

let registered = false;

export function ensureConversationObservabilityRegistered(): void {
  if (registered) return;

  const conversationState = useConversationState();
  installLongTaskObserver({
    readConversationId: () => conversationState.activeConversationId,
  });
  registered = true;
}
