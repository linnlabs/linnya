import { describe, expect, it } from 'vitest';
import type { SSEEvent } from 'linnkit/contracts';
import { createInitialProjectionState, reduceEvent } from '../index';
import type { Conversation } from '../../../types';
import { PROJECTION_TEST_SCOPE } from './helpers/projectionTestScope';
import { createAppendOnlyConversationVisualRowsBuilder } from '../../../ui/conversationView/logic/appendOnlyConversationVisualRowsBuilder';
import { createMessageEntryAnimationLedger } from '../../../ui/conversationView/logic/messageEntryAnimationLedger';

function createConversation(): Conversation {
  return {
    id: 'conversation-live-answer',
    title: '实时答案',
    titleOrigin: 'default',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    selectedAgentId: null,
    metadata: {},
  };
}

describe('实时最终答案投影', () => {
  it('从首个 chunk 到 durable seal 始终使用 answer_id，且不重建组件或重复播放动画', () => {
    const state = createInitialProjectionState(createConversation());
    const thought: SSEEvent = {
        ...PROJECTION_TEST_SCOPE,
        type: 'thought',
        id: 'thought-live-answer',
        timestamp: 1,
        conversation_id: 'conversation-live-answer',
        turn_id: 'turn-live-answer',
        execution_seq: 4,
        content: '思考完成',
        is_complete: true,
      };
    const firstChunk: SSEEvent = {
        ...PROJECTION_TEST_SCOPE,
        type: 'final_answer_chunk',
        id: 'answer-chunk-0',
        timestamp: 2,
        conversation_id: 'conversation-live-answer',
        turn_id: 'turn-live-answer',
        execution_seq: 5,
        answer_id: 'answer-live',
        seq: 0,
        chunk: '最终',
        is_last: false,
      };
    const lastChunk: SSEEvent = {
        ...PROJECTION_TEST_SCOPE,
        type: 'final_answer_chunk',
        id: 'answer-chunk-1',
        timestamp: 3,
        conversation_id: 'conversation-live-answer',
        turn_id: 'turn-live-answer',
        execution_seq: 6,
        answer_id: 'answer-live',
        seq: 1,
        chunk: '答案',
        is_last: true,
      };
    const seal: SSEEvent = {
        ...PROJECTION_TEST_SCOPE,
        type: 'final_answer',
        id: 'answer-live',
        timestamp: 4,
        conversation_id: 'conversation-live-answer',
        turn_id: 'turn-live-answer',
        execution_seq: 7,
        answer_id: 'answer-live',
        content: '最终答案',
        completion_reason: 'terminal',
      };

    expect(reduceEvent(state, thought).success).toBe(true);
    const ledger = createMessageEntryAnimationLedger();
    ledger.sync(state.conversation.id, state.conversation.messages);

    expect(reduceEvent(state, firstChunk).success).toBe(true);
    expect(state.conversation.messages[state.conversation.messages.length - 1]?.id).toBe('answer-live');
    expect(Array.from(ledger.sync(state.conversation.id, state.conversation.messages)))
      .toEqual(['answer-live']);
    ledger.consume('answer-live');

    expect(reduceEvent(state, lastChunk).success).toBe(true);
    const builder = createAppendOnlyConversationVisualRowsBuilder();
    const rowsBeforeSeal = builder.apply(state.conversation.messages, {});
    expect(rowsBeforeSeal[rowsBeforeSeal.length - 1]?.key).toBe('msg_answer-live');

    expect(reduceEvent(state, seal).success).toBe(true);
    const rowsAfterSeal = builder.apply(state.conversation.messages, {});

    expect(rowsAfterSeal[rowsAfterSeal.length - 1]?.key).toBe('msg_answer-live');
    expect(builder.getDiagnostics()).toMatchObject({
      fullRebuilds: 1,
      messageRevisionUpdates: 1,
    });
    expect(Array.from(ledger.sync(state.conversation.id, state.conversation.messages))).toEqual([]);

    expect(state.conversation.messages).toEqual([
      expect.objectContaining({
        id: 'thought-live-answer',
        type: 'thought',
        content: '思考完成',
      }),
      expect.objectContaining({
        id: 'answer-live',
        type: 'final_answer',
        content: '最终答案',
        metadata: expect.objectContaining({
          answer_id: 'answer-live',
          last_seq: 1,
          is_complete: true,
        }),
      }),
    ]);
  });

  it('完整答案不能在缺少 live chunk 时静默补造正文', () => {
    const state = createInitialProjectionState(createConversation());

    const result = reduceEvent(state, {
      ...PROJECTION_TEST_SCOPE,
      type: 'final_answer',
      id: 'answer-missing-live',
      timestamp: 2,
      conversation_id: 'conversation-live-answer',
      turn_id: 'turn-live-answer',
      answer_id: 'answer-missing-live',
      content: '不能作为 fallback 出现',
      completion_reason: 'terminal',
    });

    expect(result).toMatchObject({
      success: false,
      reason: 'final_answer answer-missing-live arrived without a live chunk stream',
    });
    expect(state.conversation.messages).toEqual([]);
  });

  it('完整答案正文必须与同 answer_id 的 chunk 聚合结果完全一致', () => {
    const state = createInitialProjectionState(createConversation());
    expect(reduceEvent(state, {
      ...PROJECTION_TEST_SCOPE,
      type: 'final_answer_chunk',
      id: 'answer-chunk-mismatch',
      timestamp: 2,
      conversation_id: 'conversation-live-answer',
      turn_id: 'turn-live-answer',
      answer_id: 'answer-mismatch',
      seq: 0,
      chunk: '实时正文',
      is_last: true,
    }).success).toBe(true);

    const result = reduceEvent(state, {
      ...PROJECTION_TEST_SCOPE,
      type: 'final_answer',
      id: 'answer-mismatch',
      timestamp: 3,
      conversation_id: 'conversation-live-answer',
      turn_id: 'turn-live-answer',
      answer_id: 'answer-mismatch',
      content: '另一份正文',
      completion_reason: 'terminal',
    });

    expect(result).toMatchObject({
      success: false,
      reason: 'final_answer answer-mismatch content does not match its live chunk stream',
    });
    expect(state.conversation.messages[0]).toMatchObject({
      id: 'answer-mismatch',
      content: '实时正文',
    });
  });

  it('工具前文本在 seal 到达时直接成为 tool_preamble，不等待后续工具事件', () => {
    const state = createInitialProjectionState(createConversation());
    expect(reduceEvent(state, {
      ...PROJECTION_TEST_SCOPE,
      type: 'final_answer_chunk',
      id: 'answer-preamble-chunk',
      timestamp: 2,
      conversation_id: 'conversation-live-answer',
      turn_id: 'turn-live-answer',
      answer_id: 'answer-preamble',
      seq: 0,
      chunk: '我先读取资料。',
      is_last: true,
    }).success).toBe(true);

    expect(reduceEvent(state, {
      ...PROJECTION_TEST_SCOPE,
      type: 'final_answer',
      id: 'answer-preamble',
      timestamp: 3,
      conversation_id: 'conversation-live-answer',
      turn_id: 'turn-live-answer',
      answer_id: 'answer-preamble',
      content: '我先读取资料。',
      completion_reason: 'tool_call',
    }).success).toBe(true);

    expect(state.conversation.messages).toEqual([
      expect.objectContaining({
        id: 'answer-preamble',
        type: 'tool_preamble',
        content: '我先读取资料。',
        metadata: expect.objectContaining({
          completion_reason: 'tool_call',
          is_complete: true,
        }),
      }),
    ]);
  });
});
