import { describe, expect, it } from 'vitest';
import {
  ConversationHistorySummaryPayloadSchema,
  ConversationSummarizationProgressMetadataSchema,
  conversationSummarizationPresentationIdFromEventId,
} from './summary-message';
import { ConversationUiMessageSchema } from './ui-message';

describe('conversation summary message contract', () => {
  it('accepts only the canonical durable history summary payload', () => {
    expect(ConversationHistorySummaryPayloadSchema.parse({
      summary: {
        info: { originalMessageCount: 8, compressedMessageCount: 1 },
        replacedMessageIds: ['message-1'],
      },
    })).toEqual({
      summary: {
        info: { originalMessageCount: 8, compressedMessageCount: 1 },
        replacedMessageIds: ['message-1'],
      },
    });

    expect(ConversationHistorySummaryPayloadSchema.safeParse({
      summaryStatus: 'completed',
      summaryInfo: { originalMessageCount: 8 },
      replacesMessageIds: ['message-1'],
    }).success).toBe(false);
  });

  it('derives renderer presentation identity from the start event identity', () => {
    expect(conversationSummarizationPresentationIdFromEventId('start-1'))
      .toBe('summarization_progress:start-1');
  });

  it('completed progress 必须显式关联唯一 durable summary fact', () => {
    const base = {
      summarization_id: 'start-1',
      turn_id: 'turn-1',
      run_id: 'run-1',
      execution_id: 'execution-1',
    };
    expect(ConversationSummarizationProgressMetadataSchema.safeParse({
      ...base,
      summary: {
        status: 'completed',
        info: { originalMessageCount: 8, compressedMessageCount: 1 },
      },
    }).success).toBe(false);
    expect(ConversationSummarizationProgressMetadataSchema.parse({
      ...base,
      summary: {
        status: 'completed',
        info: { originalMessageCount: 8, compressedMessageCount: 1 },
        historySummaryId: 'history-summary-1',
      },
    }).summary).toMatchObject({
      status: 'completed',
      historySummaryId: 'history-summary-1',
    });
  });

  it('rejects the legacy payload at the Host-to-Renderer message boundary', () => {
    expect(ConversationUiMessageSchema.safeParse({
      message_id: 'summary-1',
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      role: 'system',
      message_type: 'history_summary',
      sort_seq: 1,
      timestamp: 1,
      content: 'summary',
      payload: {
        summaryStatus: 'completed',
        summaryInfo: { originalMessageCount: 8 },
      },
      merge_key: 'summary:summary-1',
      presentation: null,
      run_id: 'run-1',
    }).success).toBe(false);
  });
});
