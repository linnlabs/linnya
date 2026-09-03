import { describe, expect, it } from 'vitest';
import type {
  SSEHistorySummaryEvent,
  SSESummarizationEndEvent,
  SSESummarizationErrorEvent,
  SSESummarizationStartEvent,
} from '@linnlabs/linnkit/contracts';

import type { Conversation } from '../../../types';
import { createInitialProjectionState, reduceEvent } from '..';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';

function createConversation(): Conversation {
  return {
    id: 'conversation-summary',
    title: 'summary lifecycle',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    selectedAgentId: null,
  };
}

function startEvent(
  overrides: Partial<SSESummarizationStartEvent> = {}
): SSESummarizationStartEvent {
  return {
    type: 'summarization_start',
    id: 'summary-start-1',
    summarization_id: 'summary-start-1',
    conversation_id: 'conversation-summary',
    turn_id: 'system',
    run_id: RunIdSchema.parse('run-1'),
    execution_id: 'execution-1',
    timestamp: 10,
    ...overrides,
  };
}

function endEvent(overrides: Partial<SSESummarizationEndEvent> = {}): SSESummarizationEndEvent {
  return {
    type: 'summarization_end',
    id: 'summary-end-1',
    summarization_id: 'summary-start-1',
    conversation_id: 'conversation-summary',
    turn_id: 'system',
    run_id: RunIdSchema.parse('run-1'),
    execution_id: 'execution-1',
    summary_id: 'summary-fact-1',
    timestamp: 20,
    original_message_count: 8,
    compressed_message_count: 1,
    compression_ratio: 0.5,
    ...overrides,
  };
}

function historySummaryEvent(
  overrides: Partial<SSEHistorySummaryEvent> = {}
): SSEHistorySummaryEvent {
  return {
    type: 'history_summary',
    id: 'summary-fact-1',
    summary_id: 'summary-fact-1',
    conversation_id: 'conversation-summary',
    turn_id: 'turn-1',
    run_id: RunIdSchema.parse('run-1'),
    execution_id: 'execution-1',
    timestamp: 21,
    content: 'durable summary',
    replaced_message_ids: ['message-1', 'message-2'],
    original_message_count: 8,
    summary_seq: 1,
    compression_ratio: 0.5,
    ...overrides,
  };
}

describe('summary projection lifecycle', () => {
  it('keeps realtime progress separate and replaces it with the durable summary fact', () => {
    const state = createInitialProjectionState(createConversation());
    const end = endEvent();
    const durable = historySummaryEvent();

    expect(reduceEvent(state, startEvent()).success).toBe(true);
    expect(state.conversation.messages).toMatchObject([
      {
        id: 'summarization_progress:summary-start-1',
        type: 'summarization_progress',
        metadata: { summary: { status: 'summarizing' } },
      },
    ]);

    expect(reduceEvent(state, end).success).toBe(true);
    if (state.conversation.messages[0]?.type !== 'summarization_progress') {
      throw new Error('Expected summarization progress message');
    }
    expect(state.conversation.messages[0].metadata.summary).toMatchObject({
      status: 'completed',
      info: { compressionRatio: 0.5 },
    });

    expect(reduceEvent(state, durable).success).toBe(true);
    expect(state.conversation.messages).toHaveLength(1);
    expect(state.conversation.messages[0]).toMatchObject({
      id: 'summary-fact-1',
      type: 'history_summary',
      content: 'durable summary',
      metadata: {
        summary: {
          replacedMessageIds: ['message-1', 'message-2'],
          info: { compressionRatio: 0.5 },
        },
      },
    });
  });

  it('projects a failed realtime presentation without creating a durable summary', () => {
    const state = createInitialProjectionState(createConversation());
    const error: SSESummarizationErrorEvent = {
      type: 'summarization_error',
      id: 'summary-error-1',
      summarization_id: 'summary-start-1',
      conversation_id: 'conversation-summary',
      turn_id: 'system',
      run_id: RunIdSchema.parse('run-1'),
      execution_id: 'execution-1',
      timestamp: 20,
      error: 'provider failed',
    };

    reduceEvent(state, startEvent());
    expect(reduceEvent(state, error).success).toBe(true);
    expect(state.conversation.messages).toMatchObject([
      {
        type: 'summarization_progress',
        metadata: { summary: { status: 'error' } },
      },
    ]);
  });

  it('accepts durable history replay without requiring realtime progress events', () => {
    const state = createInitialProjectionState(createConversation());
    const durable: SSEHistorySummaryEvent = {
      type: 'history_summary',
      id: 'summary-reload-1',
      summary_id: 'summary-reload-1',
      conversation_id: 'conversation-summary',
      turn_id: 'turn-1',
      run_id: RunIdSchema.parse('run-1'),
      execution_id: 'execution-reload',
      timestamp: 30,
      content: 'reloaded summary',
      replaced_message_ids: [],
      original_message_count: 0,
      summary_seq: 1,
    };

    expect(reduceEvent(state, durable).success).toBe(true);
    expect(state.conversation.messages).toMatchObject([
      {
        id: 'summary-reload-1',
        type: 'history_summary',
      },
    ]);
  });

  it('rejects an end event that has no matching start presentation', () => {
    const state = createInitialProjectionState(createConversation());
    const end = endEvent({
      id: 'summary-end-orphan',
      summarization_id: 'summary-start-orphan',
      original_message_count: 0,
      compressed_message_count: 0,
      compression_ratio: undefined,
    });

    expect(reduceEvent(state, end)).toMatchObject({
      success: false,
      reason: 'summarization_end received without an active summarization_start',
    });
  });

  it('routes concurrent summary signals by identity and rejects a mismatched execution scope', () => {
    const state = createInitialProjectionState(createConversation());
    reduceEvent(state, startEvent());
    reduceEvent(
      state,
      startEvent({
        id: 'summary-start-2',
        summarization_id: 'summary-start-2',
        turn_id: 'turn-2',
        run_id: RunIdSchema.parse('run-2'),
        execution_id: 'execution-2',
      })
    );

    expect(reduceEvent(state, endEvent()).success).toBe(true);
    expect(state.conversation.messages).toMatchObject([
      { metadata: { summary: { status: 'completed' } } },
      { metadata: { summary: { status: 'summarizing' } } },
    ]);

    expect(
      reduceEvent(
        state,
        endEvent({
          id: 'summary-end-2-wrong-scope',
          summarization_id: 'summary-start-2',
          turn_id: 'turn-2',
          run_id: RunIdSchema.parse('run-2'),
          execution_id: 'execution-wrong',
        })
      )
    ).toMatchObject({
      success: false,
      reason: 'summarization_end scope does not match summarization_start',
    });
    if (state.conversation.messages[1]?.type !== 'summarization_progress') {
      throw new Error('Expected second summarization progress message');
    }
    expect(state.conversation.messages[1].metadata.summary).toMatchObject({
      status: 'summarizing',
    });
  });

  it('supports consecutive summaries in one execution after each durable fact replaces its progress', () => {
    const state = createInitialProjectionState(createConversation());

    reduceEvent(state, startEvent());
    reduceEvent(state, endEvent());
    reduceEvent(state, historySummaryEvent());

    reduceEvent(
      state,
      startEvent({
        id: 'summary-start-2',
        summarization_id: 'summary-start-2',
        timestamp: 30,
      })
    );
    reduceEvent(
      state,
      endEvent({
        id: 'summary-end-2',
        summarization_id: 'summary-start-2',
        summary_id: 'summary-fact-2',
        timestamp: 31,
      })
    );
    expect(
      reduceEvent(
        state,
        historySummaryEvent({
          id: 'summary-fact-2',
          summary_id: 'summary-fact-2',
          timestamp: 32,
          content: 'second durable summary',
          summary_seq: 2,
        })
      ).success
    ).toBe(true);

    expect(state.conversation.messages).toMatchObject([
      { id: 'summary-fact-1', type: 'history_summary' },
      { id: 'summary-fact-2', type: 'history_summary' },
    ]);
  });
});
