import { describe, expect, it } from 'vitest';

import { AssistantReplayParts, ProviderContinuation, RuntimeEvent, validateAiMessage } from '..';

const continuation = {
  schema_version: 2,
  producer: {
    model_id: 'model-1',
    endpoint_id: 'anthropic',
    api_surface: 'anthropic_messages',
    capability_id: 'test:messages-codec',
    endpoint_model_id: 'claude-sonnet',
  },
  kind: 'thinking-signature',
  payload: { signature: 'opaque' },
} as const;

describe('ProviderContinuation durable contract', () => {
  it('要求版本、完整 producer route identity 与 JSON payload', () => {
    expect(ProviderContinuation.parse(continuation)).toEqual(continuation);
    expect(() => ProviderContinuation.parse({
      ...continuation,
      producer: { endpoint_id: 'anthropic' },
    })).toThrow();
  });

  it('RuntimeEvent 与 AiMessage 要求 continuation 绑定有序 assistant part', () => {
    const assistantReplayParts = [{
      type: 'text' as const,
      text: 'answer',
      provider_continuations: [continuation],
    }];
    expect(AssistantReplayParts.parse(assistantReplayParts)).toEqual(assistantReplayParts);
    const event = RuntimeEvent.parse({
      id: 'answer-1',
      type: 'final_answer',
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      timestamp: 1,
      version: 1,
      answer_id: 'answer-1',
      content: 'answer',
      completion_reason: 'terminal',
      provider_continuations: [continuation],
      assistant_replay_parts: assistantReplayParts,
    });
    expect(event.type === 'final_answer' && event.provider_continuations).toEqual([continuation]);

    const message = validateAiMessage({
      id: 'message-1',
      role: 'assistant',
      type: 'final_answer',
      content: 'answer',
      timestamp: 1,
      metadata: {
        provider_continuations: [continuation],
        assistant_replay_parts: assistantReplayParts,
      },
    });
    expect(message.success).toBe(true);

    expect(RuntimeEvent.safeParse({
      ...event,
      assistant_replay_parts: undefined,
    }).success).toBe(false);
    expect(validateAiMessage({
      id: 'message-unordered',
      role: 'assistant',
      type: 'final_answer',
      content: 'answer',
      timestamp: 1,
      metadata: { provider_continuations: [continuation] },
    }).success).toBe(false);
  });

  it('显式拒绝旧 reasoning_details，不静默删除字段', () => {
    expect(RuntimeEvent.safeParse({
      id: 'answer-1',
      type: 'final_answer',
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      timestamp: 1,
      version: 1,
      answer_id: 'answer-1',
      content: 'answer',
      completion_reason: 'terminal',
      reasoning_details: [{ signature: 'anonymous' }],
    }).success).toBe(false);

    expect(validateAiMessage({
      id: 'message-1',
      role: 'assistant',
      type: 'final_answer',
      content: 'answer',
      timestamp: 1,
      metadata: { reasoning_details: [{ signature: 'anonymous' }] },
    }).success).toBe(false);
  });
});
