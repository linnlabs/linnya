import { computed, type ComputedRef } from 'vue';
import type { BaseMessage } from '../../../types';
import type { ContextWindowUsagePresentation } from '../definitions/contextWindowUsage';
import { projectContextWindowUsage } from '../functions/projectContextWindowUsage';

export interface ContextWindowUsageSources {
  readonly hasActiveConversation: ComputedRef<boolean>;
  readonly messages: ComputedRef<readonly BaseMessage[]>;
  readonly includesConversationTail: ComputedRef<boolean>;
  readonly currentModelId: ComputedRef<string | null>;
}

export function useContextWindowUsagePresentation(
  sources: ContextWindowUsageSources,
): ComputedRef<ContextWindowUsagePresentation> {
  return computed(() => projectContextWindowUsage({
    hasActiveConversation: sources.hasActiveConversation.value,
    messages: sources.messages.value,
    includesConversationTail: sources.includesConversationTail.value,
    currentModelId: sources.currentModelId.value,
  }));
}
