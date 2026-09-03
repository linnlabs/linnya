import { describe, expect, it } from 'vitest';

import { ConversationUiMessageSchema } from './ui-message';

const common = {
  message_id: 'answer-1',
  conversation_id: 'conversation-1',
  turn_id: 'turn-1',
  sort_seq: 1,
  timestamp: 10,
  content: 'answer',
  merge_key: 'answer:answer-1',
  presentation: 'message',
  run_id: 'run-1',
};

const terminalPayload = {
  answer_id: 'answer-1',
  is_complete: true,
  completion_reason: 'terminal',
  first_token_at: 10,
};

describe('Conversation UI message discriminated contract', () => {
  it('rejects role, message type and payload combinations from different variants', () => {
    expect(ConversationUiMessageSchema.safeParse({
      ...common,
      role: 'user',
      message_type: 'final_answer',
      payload: terminalPayload,
    }).success).toBe(false);
    expect(ConversationUiMessageSchema.safeParse({
      ...common,
      role: 'assistant',
      message_type: 'partial_answer',
      payload: terminalPayload,
    }).success).toBe(false);
  });

  it('rejects removed top-level status and metadata escape hatches', () => {
    expect(ConversationUiMessageSchema.safeParse({
      ...common,
      role: 'assistant',
      message_type: 'final_answer',
      payload: terminalPayload,
      status: 'success',
    }).success).toBe(false);
    expect(ConversationUiMessageSchema.safeParse({
      ...common,
      role: 'assistant',
      message_type: 'final_answer',
      payload: terminalPayload,
      metadata: {},
    }).success).toBe(false);
  });
});
