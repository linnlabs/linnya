import { describe, expect, it } from 'vitest';
import { RunIdSchema } from 'linnkit/contracts';
import type {
  SSEHistorySummaryEvent,
  SSESummarizationEndEvent,
  SSESummarizationStartEvent,
} from 'linnkit/contracts';

import type { Conversation } from '../../types';
import { createInitialProjectionState, reduceEvent } from '../../services/messageProjection';
import type { UiMessageDto } from '../definitions/uiMessagesDto';
import { mapUiMessageDtoToWindowRow } from '../functions/mapUiMessageDto';
import { mergeWindowAndLiveMessages } from '../functions/mergeWindowAndLiveMessages';

const CONVERSATION_ID = 'conversation-summary-recovery';
const RUN_ID = RunIdSchema.parse('run-summary-recovery');
const EXECUTION_ID = 'execution-summary-recovery';

function createConversation(): Conversation {
  return {
    id: CONVERSATION_ID,
    title: 'summary recovery',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    selectedAgentId: null,
  };
}

function startEvent(): SSESummarizationStartEvent {
  return {
    type: 'summarization_start',
    id: 'summary-start-1',
    summarization_id: 'summary-start-1',
    conversation_id: CONVERSATION_ID,
    turn_id: 'turn-1',
    run_id: RUN_ID,
    execution_id: EXECUTION_ID,
    timestamp: 10,
  };
}

function endEvent(summaryId: string): SSESummarizationEndEvent {
  return {
    type: 'summarization_end',
    id: `summary-end:${summaryId}`,
    summarization_id: 'summary-start-1',
    summary_id: summaryId,
    conversation_id: CONVERSATION_ID,
    turn_id: 'turn-1',
    run_id: RUN_ID,
    execution_id: EXECUTION_ID,
    timestamp: 20,
    original_message_count: 8,
    compressed_message_count: 1,
    compression_ratio: 0.5,
  };
}

function historySummaryEvent(summaryId: string): SSEHistorySummaryEvent {
  return {
    type: 'history_summary',
    id: summaryId,
    summary_id: summaryId,
    conversation_id: CONVERSATION_ID,
    turn_id: 'turn-1',
    run_id: RUN_ID,
    execution_id: EXECUTION_ID,
    timestamp: 21,
    content: 'durable summary',
    replaced_message_ids: ['message-1', 'message-2'],
    original_message_count: 8,
    summary_seq: 1,
    compression_ratio: 0.5,
  };
}

function historySummaryDto(summaryId: string): UiMessageDto {
  return {
    message_id: summaryId,
    conversation_id: CONVERSATION_ID,
    turn_id: 'turn-1',
    role: 'system',
    message_type: 'history_summary',
    sort_seq: 1,
    timestamp: 21,
    content: 'durable summary',
    payload: {
      summary: {
        info: {
          originalMessageCount: 8,
          compressedMessageCount: 1,
          compressionRatio: 0.5,
        },
        replacedMessageIds: ['message-1', 'message-2'],
      },
    },
    merge_key: `summary:${summaryId}`,
    presentation: null,
    run_id: RUN_ID,
  };
}

describe('history summary live → reload recovery', () => {
  it('同一 durable fact 经 realtime 投影后，用相同 message ID 与 reload window 合并', () => {
    const state = createInitialProjectionState(createConversation());
    reduceEvent(state, startEvent());
    reduceEvent(state, endEvent('history-summary-1'));
    expect(reduceEvent(state, historySummaryEvent('history-summary-1')).success).toBe(true);

    const merged = mergeWindowAndLiveMessages(
      [mapUiMessageDtoToWindowRow(historySummaryDto('history-summary-1'), 1)],
      state.conversation.messages,
    );

    expect(merged.messages).toHaveLength(1);
    expect(merged.messages[0]).toMatchObject({
      id: 'history-summary-1',
      type: 'history_summary',
    });
    expect(merged.messages.some(message => message.type === 'summarization_progress')).toBe(false);
  });

  it('history_summary realtime 丢失时，reload 仍按明确 fact ID 清除 completed progress', () => {
    const state = createInitialProjectionState(createConversation());
    reduceEvent(state, startEvent());
    reduceEvent(state, endEvent('history-summary-1'));

    const merged = mergeWindowAndLiveMessages(
      [mapUiMessageDtoToWindowRow(historySummaryDto('history-summary-1'), 1)],
      state.conversation.messages,
    );

    expect(merged.messages.map(message => [message.id, message.type])).toEqual([
      ['history-summary-1', 'history_summary'],
    ]);
  });

  it('同一 run 的另一条摘要不得清除不属于它的 completed progress', () => {
    const state = createInitialProjectionState(createConversation());
    reduceEvent(state, startEvent());
    reduceEvent(state, endEvent('history-summary-2'));

    const merged = mergeWindowAndLiveMessages(
      [mapUiMessageDtoToWindowRow(historySummaryDto('history-summary-1'), 1)],
      state.conversation.messages,
    );

    expect(merged.messages.map(message => message.type)).toEqual([
      'history_summary',
      'summarization_progress',
    ]);
  });
});
