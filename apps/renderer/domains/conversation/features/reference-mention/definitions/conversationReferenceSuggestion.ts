import type {
  ConversationReferenceCandidate,
  ConversationReferenceProviderContribution,
} from '@linnya/plugin-host-contract/renderer';

export interface ConversationReferenceSuggestionItem {
  readonly key: string;
  readonly provider: ConversationReferenceProviderContribution;
  readonly candidate: ConversationReferenceCandidate;
}
