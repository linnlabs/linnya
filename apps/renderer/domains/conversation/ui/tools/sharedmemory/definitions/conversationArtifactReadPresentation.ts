import type {
  HistoricalConversationArtifactReadData,
  HistoricalConversationArtifactReadSource,
} from '@app/schemas';

export type ConversationArtifactReadPresentationData =
  | {
      readonly kind: 'lifecycle';
      readonly source?: HistoricalConversationArtifactReadSource;
    }
  | {
      readonly kind: 'snapshot';
      readonly source: HistoricalConversationArtifactReadSource;
      readonly artifact: HistoricalConversationArtifactReadData;
    };
