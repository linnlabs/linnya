import { describe, expect, it } from 'vitest';

import {
  ConversationAnswerMessageMetadataSchema,
  ConversationAnswerMessagePayloadSchema,
  ConversationContextUsageSchema,
  ConversationMessageExtensionSchema,
  ConversationThoughtMessageMetadataSchema,
  ConversationThoughtMessagePayloadSchema,
  parseConversationAnswerMessageMetadata,
} from './message-metadata';

const answerCommon = {
  answer_id: 'answer-1',
  first_token_at: 10,
};

describe('Conversation answer and extension contracts', () => {
  it('严格接纳 UI 所需的 Prompt 占用与两个等式', () => {
    const usage = {
      budget_model_id: 'primary-model',
      used_tokens: 900,
      components: {
        system_prompt_tokens: 200,
        conversation_tokens: 600,
        tool_definition_tokens: 100,
      },
      input_budget_tokens: 1_000,
      remaining_tokens: 100,
      output_limit_tokens: 200,
      source: 'provider-preflight-count' as const,
      confidence: 'provider-estimate' as const,
    };

    expect(ConversationContextUsageSchema.safeParse(usage).success).toBe(true);
    expect(ConversationContextUsageSchema.safeParse({
      ...usage,
      source: 'guessed',
    }).success).toBe(false);
    expect(ConversationContextUsageSchema.safeParse({
      ...usage,
      remaining_tokens: 99,
    }).success).toBe(false);
  });

  it('keeps unsealed chunk completion separate from the final seal reason', () => {
    expect(ConversationAnswerMessageMetadataSchema.safeParse({
      ...answerCommon,
      turn_id: 'turn-1',
      run_id: 'run-1',
      is_complete: true,
    }).success).toBe(true);

    expect(ConversationAnswerMessagePayloadSchema.safeParse({
      ...answerCommon,
      is_complete: false,
      completion_reason: 'terminal',
    }).success).toBe(false);
    expect(ConversationAnswerMessagePayloadSchema.safeParse({
      ...answerCommon,
      is_complete: true,
      completion_reason: 'interrupted',
    }).success).toBe(false);
  });

  it('binds each rendered answer type to its own seal reason', () => {
    const sealed = {
      ...answerCommon,
      turn_id: 'turn-1',
      run_id: 'run-1',
      is_complete: true,
      completion_reason: 'terminal',
    };
    expect(() => parseConversationAnswerMessageMetadata('final_answer', sealed)).not.toThrow();
    expect(() => parseConversationAnswerMessageMetadata('tool_preamble', sealed)).toThrow();
    expect(() => parseConversationAnswerMessageMetadata('partial_answer', sealed)).toThrow();
  });

  it('binds completed thought state to its completion timestamp', () => {
    const common = { thought_started_at: 10 };
    expect(ConversationThoughtMessagePayloadSchema.safeParse({
      ...common,
      is_complete: false,
    }).success).toBe(true);
    expect(ConversationThoughtMessagePayloadSchema.safeParse({
      ...common,
      is_complete: false,
      thought_completed_at: 11,
    }).success).toBe(false);
    expect(ConversationThoughtMessagePayloadSchema.safeParse({
      ...common,
      is_complete: true,
    }).success).toBe(false);
    expect(ConversationThoughtMessageMetadataSchema.safeParse({
      ...common,
      is_complete: true,
      thought_completed_at: 11,
      turn_id: 'turn-1',
      run_id: 'run-1',
    }).success).toBe(true);
  });

  it('accepts only namespaced pure JSON plugin extensions', () => {
    expect(ConversationMessageExtensionSchema.safeParse({
      namespace: 'mindmap.selection',
      data: { nodeIds: ['node-1'], options: { depth: 2 } },
    }).success).toBe(true);
    expect(ConversationMessageExtensionSchema.safeParse({
      namespace: 'mindmap.selection',
      data: { callback: () => undefined },
    }).success).toBe(false);
    expect(ConversationMessageExtensionSchema.safeParse({
      namespace: 'mindmap.selection',
      data: { createdAt: new Date(0) },
    }).success).toBe(false);
    expect(ConversationMessageExtensionSchema.safeParse({
      namespace: 'mindmap.selection',
      data: { missing: undefined },
    }).success).toBe(false);
  });
});
