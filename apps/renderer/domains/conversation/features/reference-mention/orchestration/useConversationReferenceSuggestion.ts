import { readonly, ref } from 'vue';
import {
  readConversationReferenceProviders,
  useComposerReferences,
} from '../../composer-references';
import { createConversationReferenceSuggestionExtension } from '../extension/ConversationReferenceSuggestionExtension';
import {
  hasAvailableConversationReferenceProvider,
  queryConversationReferenceSuggestions,
} from './queryConversationReferenceSuggestions';

const REFERENCE_SUGGESTION_LIMIT = 20;

export interface ConversationReferenceSuggestionAvailability {
  readonly canUseReferences: () => boolean;
}

export function useConversationReferenceSuggestion(
  availability: ConversationReferenceSuggestionAvailability,
) {
  const composerReferences = useComposerReferences();
  const isOpen = ref(false);

  const editorExtension = createConversationReferenceSuggestionExtension({
    canStart: () => availability.canUseReferences()
      && hasAvailableConversationReferenceProvider(readConversationReferenceProviders()),
    query: keyword => queryConversationReferenceSuggestions(
      readConversationReferenceProviders(),
      keyword,
      REFERENCE_SUGGESTION_LIMIT,
    ),
    select: item => {
      composerReferences.addReference(item.provider.resolveReference(item.candidate));
    },
    onOpenChange: value => {
      isOpen.value = value;
    },
  });

  return {
    isOpen: readonly(isOpen),
    editorExtension,
  };
}
