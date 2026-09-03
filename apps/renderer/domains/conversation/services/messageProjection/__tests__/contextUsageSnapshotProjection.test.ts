import { describe, expect, it } from 'vitest';
import { RunIdSchema, type SSEContextUsageSnapshotEvent } from 'linnkit/contracts';

import type { BaseMessage, Conversation } from '../../../types';
import { createInitialProjectionState, reduceEvent } from '../index';

function createConversation(messages: BaseMessage[]): Conversation {
  return {
    id: 'conversation-context-usage',
    title: 'context usage',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages,
    selectedAgentId: null,
  };
}

function createEvent(
  id: string,
  usedTokens: number,
  userMessageId: string | undefined = 'user-message-1',
): SSEContextUsageSnapshotEvent {
  return {
    type: 'context_usage_snapshot',
    id,
    timestamp: usedTokens,
    conversation_id: 'conversation-context-usage',
    turn_id: 'turn-1',
    run_id: RunIdSchema.parse('run-1'),
    execution_id: 'execution-1',
    ...(userMessageId ? { user_message_id: userMessageId } : {}),
    context_usage: {
      basis: 'last_completed_llm_prompt',
      budget_model_id: 'primary-model',
      used_tokens: usedTokens,
      components: {
        system_prompt_tokens: 200,
        conversation_tokens: usedTokens - 300,
        tool_definition_tokens: 100,
      },
      component_attribution: 'normalized_local_estimate',
      input_budget_tokens: 1_000,
      remaining_tokens: 1_000 - usedTokens,
      output_limit_tokens: 200,
      source: 'test-fixture',
      confidence: 'estimate',
      measured_at: usedTokens,
    },
  };
}

describe('context usage snapshot message projection', () => {
  it('按 user_message_id 原位刷新最近成功 Prompt 占用，并保留同消息的其他 metadata', () => {
    const state = createInitialProjectionState(createConversation([{
      id: 'user-message-1',
      role: 'user',
      type: 'user_input',
      content: '执行任务',
      timestamp: 1,
      metadata: {
        agent_work: {
          duration_ms: 10,
          ended_at: 11,
          outcome: 'completed',
        },
      },
    }]));

    expect(reduceEvent(state, createEvent('usage-1', 700)).success).toBe(true);
    expect(reduceEvent(state, createEvent('usage-2', 900)).success).toBe(true);

    const message = state.conversation.messages[0];
    if (message?.type !== 'user_input') throw new Error('Expected user input message');
    expect(message.metadata).toMatchObject({
      agent_work: {
        duration_ms: 10,
        ended_at: 11,
        outcome: 'completed',
      },
      context_usage: {
        budget_model_id: 'primary-model',
        used_tokens: 900,
        remaining_tokens: 100,
      },
    });
  });

  it('缺少 Host 绑定的用户消息身份时不猜测目标消息', () => {
    const state = createInitialProjectionState(createConversation([]));

    expect(reduceEvent(state, createEvent('usage-without-target', 900, undefined))).toMatchObject({
      success: true,
    });
    expect(state.conversation.messages).toEqual([]);
  });
});
