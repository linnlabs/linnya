import type { SummarizationProgressMessage } from '../../../types';
import type {
  ConversationSummarizationProgressMetadata,
  ConversationSummaryInfo,
} from '@app/schemas';
import {
  conversationSummarizationPresentationIdFromEventId,
  ConversationSummarizationProgressMetadataSchema,
} from '@app/schemas';

type SummarizationProgressStatus = ConversationSummarizationProgressMetadata['summary']['status'];

export function buildSummaryContent(status: SummarizationProgressStatus): string {
  switch (status) {
    case 'summarizing':
      return 'Summarizing conversation history...';
    case 'completed':
      return 'Conversation history summarized';
    case 'error':
      return 'Conversation history summary failed';
  }
}

export function createSummarizationProgressMessage(input: {
  eventId: string;
  timestamp: number;
  turnId: string;
  runId: string;
  executionId: string;
  info: ConversationSummaryInfo;
}): SummarizationProgressMessage {
  return {
    id: conversationSummarizationPresentationIdFromEventId(input.eventId),
    role: 'system',
    type: 'summarization_progress',
    content: buildSummaryContent('summarizing'),
    timestamp: input.timestamp,
    metadata: ConversationSummarizationProgressMetadataSchema.parse({
      summarization_id: input.eventId,
      turn_id: input.turnId,
      run_id: input.runId,
      execution_id: input.executionId,
      summary: {
        status: 'summarizing',
        info: input.info,
      },
    }),
  };
}

export function completeSummarizationProgressMessage(
  message: SummarizationProgressMessage,
  historySummaryId: string,
  info: ConversationSummaryInfo,
): SummarizationProgressMessage {
  return {
    ...message,
    content: buildSummaryContent('completed'),
    metadata: ConversationSummarizationProgressMetadataSchema.parse({
      summarization_id: message.metadata.summarization_id,
      turn_id: message.metadata.turn_id,
      run_id: message.metadata.run_id,
      execution_id: message.metadata.execution_id,
      summary: { status: 'completed', info, historySummaryId },
    }),
  };
}

export function failSummarizationProgressMessage(
  message: SummarizationProgressMessage,
): SummarizationProgressMessage {
  return {
    ...message,
    content: buildSummaryContent('error'),
    metadata: ConversationSummarizationProgressMetadataSchema.parse({
      summarization_id: message.metadata.summarization_id,
      turn_id: message.metadata.turn_id,
      run_id: message.metadata.run_id,
      execution_id: message.metadata.execution_id,
      summary: { status: 'error', info: message.metadata.summary.info },
    }),
  };
}
