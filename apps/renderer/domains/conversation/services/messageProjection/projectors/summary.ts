import type {
  HistorySummaryMessage,
  SummarizationProgressMessage,
} from '../../../types';
import type {
  SSEHistorySummaryEvent,
  SSESummarizationEndEvent,
  SSESummarizationErrorEvent,
  SSESummarizationStartEvent,
} from 'linnkit/contracts';
import {
  conversationSummarizationPresentationIdFromEventId,
  ConversationSummarizationProgressMetadataSchema,
} from '@app/schemas';
import type { MessageProjectionState, ProjectionResult } from '../state';
import {
  completeSummarizationProgressMessage,
  createSummarizationProgressMessage,
  failSummarizationProgressMessage,
} from '../../../features/summary-presentation';
import {
  appendMessage,
  getMessageById,
  removeMessageById,
  replaceMessageById,
} from '../helpers/messageAccess';

/**
 * 摘要有两种不同所有权：summarization_* 只描述当前传输的 presentation，
 * history_summary 才是可回放事实。这里禁止用同一个 type 或同一份 metadata 混装二者。
 */

function readSummarizationProgress(
  state: MessageProjectionState,
  summarizationId: string,
): SummarizationProgressMessage | null {
  const presentationId = conversationSummarizationPresentationIdFromEventId(summarizationId);
  const message = getMessageById(state, presentationId);
  if (!message) return null;
  if (message.type !== 'summarization_progress') {
    throw new Error(`Summarization presentation identity collision: ${presentationId}`);
  }
  const metadata = ConversationSummarizationProgressMetadataSchema.parse(message.metadata);
  if (metadata.summarization_id !== summarizationId) {
    throw new Error(`Summarization presentation identity mismatch: ${presentationId}`);
  }
  return { ...message, id: presentationId, metadata };
}

function requireActiveSummarizationProgress(
  state: MessageProjectionState,
  event: SSESummarizationEndEvent | SSESummarizationErrorEvent,
): SummarizationProgressMessage {
  const message = readSummarizationProgress(state, event.summarization_id);
  if (!message || message.metadata.summary.status !== 'summarizing') {
    throw new Error(`${event.type} received without an active summarization_start`);
  }
  const metadata = message.metadata;
  if (
    metadata.turn_id !== event.turn_id
    || metadata.run_id !== event.run_id
    || metadata.execution_id !== event.execution_id
  ) {
    throw new Error(`${event.type} scope does not match summarization_start`);
  }
  return message;
}

function findCompletedProgressForHistorySummary(
  state: MessageProjectionState,
  event: SSEHistorySummaryEvent,
): SummarizationProgressMessage | null {
  const runId = requireHistorySummaryRunId(event);
  if (!event.execution_id) throw new Error('history_summary requires execution_id');
  const scopedProgress = state.conversation.messages.flatMap((message) => {
    if (message.type !== 'summarization_progress') return [];
    const metadata = ConversationSummarizationProgressMetadataSchema.parse(message.metadata);
    if (metadata.run_id !== runId || metadata.execution_id !== event.execution_id) return [];
    return [{
      ...message,
      id: conversationSummarizationPresentationIdFromEventId(metadata.summarization_id),
      metadata,
    }];
  });
  const matches = scopedProgress.filter(message => (
    message.metadata.summary.status === 'completed'
    && message.metadata.summary.historySummaryId === event.summary_id
  ));
  if (matches.length > 1) {
    throw new Error(`Multiple summarization presentations reference summary ${event.summary_id}`);
  }
  const match = matches[0] ?? null;
  if (!match && scopedProgress.some(message => message.metadata.summary.status === 'summarizing')) {
    throw new Error(`history_summary received before summarization_end: ${event.summary_id}`);
  }
  return match;
}

function requireHistorySummaryRunId(event: SSEHistorySummaryEvent): string {
  if (!event.run_id) throw new Error('history_summary requires run_id');
  return event.run_id;
}

export function projectSummarizationStartEvent(
  state: MessageProjectionState,
  event: SSESummarizationStartEvent,
): ProjectionResult {
  if (event.id !== event.summarization_id) {
    throw new Error('summarization_start id must equal summarization_id');
  }
  if (readSummarizationProgress(state, event.summarization_id)) {
    throw new Error(`Duplicate summarization presentation: ${event.summarization_id}`);
  }
  const message = createSummarizationProgressMessage({
    eventId: event.summarization_id,
    timestamp: event.timestamp,
    turnId: event.turn_id,
    runId: event.run_id,
    executionId: event.execution_id,
    info: { originalMessageCount: 0 },
  });
  appendMessage(state, message);
  return { success: true, messageId: message.id, newState: state };
}

export function projectSummarizationEndEvent(
  state: MessageProjectionState,
  event: SSESummarizationEndEvent,
): ProjectionResult {
  const current = requireActiveSummarizationProgress(
    state,
    event,
  );
  const updated = completeSummarizationProgressMessage(current, event.summary_id, {
    originalMessageCount: event.original_message_count,
    compressedMessageCount: event.compressed_message_count,
    ...(event.compression_ratio === undefined
      ? {}
      : { compressionRatio: event.compression_ratio }),
  });
  replaceMessageById(state, current.id, updated);
  return { success: true, messageId: updated.id, newState: state };
}

export function projectSummarizationErrorEvent(
  state: MessageProjectionState,
  event: SSESummarizationErrorEvent,
): ProjectionResult {
  const current = requireActiveSummarizationProgress(
    state,
    event,
  );
  const updated = failSummarizationProgressMessage(current);
  replaceMessageById(state, current.id, updated);
  return { success: true, messageId: updated.id, newState: state };
}

export function projectHistorySummaryEvent(
  state: MessageProjectionState,
  event: SSEHistorySummaryEvent,
): ProjectionResult {
  const progress = findCompletedProgressForHistorySummary(state, event);
  if (progress) removeMessageById(state, progress.id);

  const message: HistorySummaryMessage = {
    id: event.summary_id,
    role: 'system',
    type: 'history_summary',
    content: event.content,
    timestamp: event.timestamp,
    metadata: {
      turn_id: event.turn_id,
      run_id: requireHistorySummaryRunId(event),
      summary: {
        info: {
          originalMessageCount: event.original_message_count,
          compressedMessageCount: 1,
          ...(event.compression_ratio === undefined
            ? {}
            : { compressionRatio: event.compression_ratio }),
        },
        replacedMessageIds: event.replaced_message_ids,
        ...(event.included_old_summary === undefined
          ? {}
          : { includedOldSummary: event.included_old_summary }),
      },
    },
  };
  appendMessage(state, message);
  return { success: true, messageId: message.id, newState: state };
}
