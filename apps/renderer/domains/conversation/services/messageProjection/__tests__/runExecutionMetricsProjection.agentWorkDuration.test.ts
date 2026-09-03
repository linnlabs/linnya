import { describe, expect, it } from 'vitest';
import type { SSERunExecutionMetricsEvent } from 'linnkit/contracts';

import type { BaseMessage, Conversation } from '../../../types';
import { createInitialProjectionState } from '../index';
import { projectRunExecutionMetricsEvent } from '../projectors/runExecutionMetrics';

function createConversation(messages: BaseMessage[] = []): Conversation {
  return {
    id: 'conversation-metrics-1',
    title: 'test',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages,
    selectedAgentId: null,
  };
}

const contextUsage = {
  basis: 'last_completed_llm_prompt' as const,
  budget_model_id: 'primary-model',
  used_tokens: 900,
  components: {
    system_prompt_tokens: 200,
    conversation_tokens: 600,
    tool_definition_tokens: 100,
  },
  component_attribution: 'normalized_local_estimate' as const,
  input_budget_tokens: 1_000,
  remaining_tokens: 100,
  output_limit_tokens: 200,
  source: 'provider-preflight-count' as const,
  confidence: 'provider-estimate' as const,
  measured_at: 301_000,
};

describe('run execution metrics message projection', () => {
  it('按正式 user_message_id 把执行耗时和结果归档到触发消息', () => {
    const userMessage: BaseMessage = {
      id: 'user-message-1',
      role: 'user',
      type: 'user_input',
      content: 'do something',
      timestamp: 1,
      metadata: {},
    };
    const state = createInitialProjectionState(createConversation([userMessage]));
    const event: SSERunExecutionMetricsEvent = {
      type: 'run_execution_metrics',
      id: 'metrics-1',
      timestamp: 301_001,
      conversation_id: 'conversation-metrics-1',
      turn_id: 'turn-1',
      execution_id: 'execution-1',
      outcome: 'completed',
      duration_ms: 301_000,
      user_message_id: 'user-message-1',
      context_usage: contextUsage,
    };

    projectRunExecutionMetricsEvent(state, event);

    expect(state.conversation.messages[0]?.metadata).toEqual(expect.objectContaining({
      agent_work: {
        duration_ms: 301_000,
        ended_at: 301_001,
        outcome: 'completed',
      },
      context_usage: {
        budget_model_id: 'primary-model',
        used_tokens: 900,
        components: contextUsage.components,
        input_budget_tokens: 1_000,
        remaining_tokens: 100,
        output_limit_tokens: 200,
        source: 'provider-preflight-count',
        confidence: 'provider-estimate',
      },
    }));
  });

  it('后续 metrics 没有新快照时保留同一用户消息上的最近成功占用', () => {
    const userMessage: BaseMessage = {
      id: 'user-message-1',
      role: 'user',
      type: 'user_input',
      content: 'continue',
      timestamp: 1,
      metadata: {
        context_usage: {
          budget_model_id: 'primary-model',
          used_tokens: 900,
          components: contextUsage.components,
          input_budget_tokens: 1_000,
          remaining_tokens: 100,
          output_limit_tokens: 200,
          source: 'provider-preflight-count',
          confidence: 'provider-estimate',
        },
      },
    };
    const state = createInitialProjectionState(createConversation([userMessage]));

    projectRunExecutionMetricsEvent(state, {
      type: 'run_execution_metrics',
      id: 'metrics-2',
      timestamp: 302_000,
      conversation_id: 'conversation-metrics-1',
      turn_id: 'turn-1',
      execution_id: 'execution-2',
      outcome: 'failed',
      duration_ms: 1_000,
      user_message_id: 'user-message-1',
    });

    const projectedMessage = state.conversation.messages[0];
    if (projectedMessage?.type !== 'user_input') {
      throw new Error('Expected projected user message');
    }
    expect(projectedMessage.metadata?.context_usage).toEqual(userMessage.metadata?.context_usage);
  });
});
