import { describe, expect, it } from 'vitest';
import { runContext } from '@linnlabs/linnkit/runtime-kernel';
import {
  createContextUsageSnapshotEvent,
  type RequiresUserInteractionEvent,
} from '@linnlabs/linnkit/contracts';
import { RunLifecycleCoordinator } from '../runLifecycleCoordinator';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

describe('RunLifecycleCoordinator execution-scoped 事件上下文', () => {
  it('只为 Graph 草稿补充非路由 trace metadata，不拥有 run routing identity', () => {
    const conversationId = 'conversation-title';
    const turnId = 'turn-title';
    const rootRunId = RunIdSchema.parse('run-root-title');
    const coordinator = new RunLifecycleCoordinator({
      conversationId,
      turnId,
      options: {
        run_lane: 'auxiliary',
        event_visibility: 'none',
      },
    });
    coordinator.configureRunContext(
      runContext.createRunContext({
        runId: RunIdSchema.parse('run-title'),
        traceId: 'trace-title',
        rootRunId,
      })
    );
    const waitEvent: RequiresUserInteractionEvent = {
      type: 'requires_user_interaction',
      id: 'interaction-title',
      conversation_id: conversationId,
      turn_id: turnId,
      timestamp: 1,
      version: 1,
      form: { prompt: '补充标题信息' },
      interaction_id: 'interaction-title',
      run_id: RunIdSchema.parse('run-title'),
      tool_call_id: ToolCallIdSchema.parse('ask-title'),
      checkpoint_revision: 3,
      resume_token: 'resume-title',
      interaction_status: 'pending',
      metadata: { graph_control: true },
    };

    expect(coordinator.getMappingContext()).not.toHaveProperty('routingIdentity');
    expect(coordinator.enrichRuntimeEvent(waitEvent)).toMatchObject({
      run_id: 'run-title',
      metadata: {
        graph_control: true,
        runtime_trace: {
          traceId: 'trace-title',
          rootRunId,
          tags: {},
        },
      },
    });
  });

  it('只在 Host 产品边界为上下文快照绑定当前用户消息身份', () => {
    const conversationId = 'conversation-context-usage';
    const turnId = 'turn-context-usage';
    const userMessageId = 'user-context-usage';
    const coordinator = new RunLifecycleCoordinator({
      conversationId,
      turnId,
      userMessageId,
      options: {},
    });
    const event = createContextUsageSnapshotEvent(
      'context-usage-event',
      conversationId,
      turnId,
      {
        basis: 'last_completed_llm_prompt',
        budget_model_id: 'primary-model',
        used_tokens: 900,
        components: {
          system_prompt_tokens: 200,
          conversation_tokens: 600,
          tool_definition_tokens: 100,
        },
        component_attribution: 'normalized_local_estimate',
        input_budget_tokens: 1_000,
        remaining_tokens: 100,
        output_limit_tokens: 200,
        source: 'test-fixture',
        confidence: 'estimate',
        measured_at: 1,
      },
    );

    expect(event.user_message_id).toBeUndefined();
    expect(coordinator.enrichRuntimeEvent(event)).toMatchObject({
      type: 'context_usage_snapshot',
      user_message_id: userMessageId,
    });
  });
});
