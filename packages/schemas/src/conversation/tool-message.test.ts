import { describe, expect, it } from 'vitest';

import { ConversationToolMessageMetadataSchema } from './tool-message';
import { ConversationUiMessageSchema } from './ui-message';

function toolMessage(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    message_id: 'tool-message-1',
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    role: 'assistant',
    message_type: 'tool_calls',
    sort_seq: 1,
    timestamp: 10,
    content: '',
    payload,
    merge_key: 'tool:call-1',
    presentation: null,
    run_id: 'run-1',
  };
}

const validPayload = {
  tool_call_id: 'call-1',
  tool_name: 'resource_read',
  status: 'success',
  phase: 'complete',
  started_at: 1,
  completed_at: 10,
};

describe('Conversation tool message contract', () => {
  it.each(['tool_call_id', 'tool_name', 'status'] as const)(
    'rejects tool messages without %s',
    (field) => {
      const { [field]: _removed, ...incomplete } = validPayload;
      expect(ConversationUiMessageSchema.safeParse(toolMessage(incomplete)).success).toBe(false);
    },
  );

  it.each(['rawPayload', 'displayOptions', 'primary_tool_call_id', 'tool_calls'] as const)(
    'rejects removed UI payload field %s',
    (field) => {
      expect(ConversationUiMessageSchema.safeParse(toolMessage({
        ...validPayload,
        [field]: {},
      })).success).toBe(false);
    },
  );

  it('rejects backend-driven presentation in durable rows and Renderer metadata', () => {
    expect(ConversationUiMessageSchema.safeParse({
      ...toolMessage(validPayload),
      presentation: 'hidden',
    }).success).toBe(false);
    expect(ConversationToolMessageMetadataSchema.safeParse({
      ...validPayload,
      turn_id: 'turn-1',
      run_id: 'run-1',
      ui: { presentation: 'hidden' },
    }).success).toBe(false);
  });

  it('requires status, phase and completed_at to describe one lifecycle state', () => {
    expect(ConversationUiMessageSchema.safeParse(toolMessage({
      ...validPayload,
      status: 'loading',
      phase: 'start',
      completed_at: 10,
    })).success).toBe(false);
    expect(ConversationUiMessageSchema.safeParse(toolMessage({
      ...validPayload,
      status: 'success',
      phase: 'update',
    })).success).toBe(false);
    expect(ConversationUiMessageSchema.safeParse(toolMessage({
      ...validPayload,
      status: 'error',
      phase: 'error',
      error: 'tool failed',
    })).success).toBe(true);
  });
});
