import { describe, expect, it } from 'vitest';
import {
  getRuntimeEventUiProjectionKind,
  RUNTIME_EVENT_TYPES_NEVER_REPLAYED_TO_UI,
  describeRuntimeEventLifecycle,
  shouldEnterAgentContext,
  shouldEmitRuntimeEventToSse,
  shouldPersistRuntimeEvent,
  shouldReplayRuntimeEventToUi,
} from '../eventGovernance';
import { routeRuntimeEvent, validateRuntimeEvent } from '../../../contracts';
import type { RuntimeEvent } from '../../../contracts';

function createBaseEvent(
  event: Record<string, unknown> & { id: string; type: RuntimeEvent['type'] },
): RuntimeEvent {
  const candidate = {
    ...event,
    conversation_id: 'conv_contract',
    turn_id: 'turn_contract',
    timestamp: 1,
    version: 1,
  };
  const parsed = validateRuntimeEvent(candidate);
  if (!parsed.success) {
    throw parsed.error;
  }
  return routeRuntimeEvent(parsed.data, {
    run_id: 'run_contract',
    lane: 'foreground',
    visibility: 'conversation',
  });
}

describe('eventGovernance contract', () => {
  it('类型级 SQL 排除清单必须与 replayToUi=false 保持一致', () => {
    const eventsByType = {
      audit_envelope: createBaseEvent({
        type: 'audit_envelope',
        id: 'audit_never_replay',
        envelope: {
          envelopeId: 'audit_1',
          runId: 'run_1',
          ts: 1,
          actor: { kind: 'system' },
          action: 'context.manager.before',
          scope: {
            conversationId: 'conv_contract',
            runId: 'run_1',
            turnId: 'turn_contract',
          },
        },
      }),
      final_answer_chunk: createBaseEvent({
        type: 'final_answer_chunk',
        id: 'chunk_never_replay',
        answer_id: 'answer_1',
        seq: 0,
        content: 'partial',
        is_last: false,
        ephemeral: true,
      }),
      final_answer_reset: createBaseEvent({
        type: 'final_answer_reset',
        id: 'reset_never_replay',
        ephemeral: true,
        answer_id: 'answer_failed',
        thought_message_ids: ['thought_failed'],
      }),
      subrun_trace: createBaseEvent({
        type: 'subrun_trace',
        id: 'subrun_never_replay',
        ephemeral: true,
        parent_tool_call_id: 'call_parent',
        subrun_id: 'sub_1',
        source_event_id: 'child_process_1',
        kind: 'tool_process',
        tool_name: 'delegate',
        tool_call_id: 'call_child',
        phase: 'start',
        status: 'loading',
        args: {},
      }),
      context_usage_snapshot: createBaseEvent({
        type: 'context_usage_snapshot',
        id: 'context_usage_never_replay',
        ephemeral: true,
        user_message_id: 'user_1',
        context_usage: {
          basis: 'last_completed_llm_prompt',
          budget_model_id: 'model_1',
          used_tokens: 90,
          components: {
            system_prompt_tokens: 20,
            conversation_tokens: 60,
            tool_definition_tokens: 10,
          },
          component_attribution: 'normalized_local_estimate',
          input_budget_tokens: 100,
          remaining_tokens: 10,
          output_limit_tokens: 20,
          source: 'local-estimate',
          confidence: 'estimate',
          measured_at: 1,
        },
      }),
    } satisfies Record<typeof RUNTIME_EVENT_TYPES_NEVER_REPLAYED_TO_UI[number], RuntimeEvent>;

    for (const eventType of RUNTIME_EVENT_TYPES_NEVER_REPLAYED_TO_UI) {
      expect(describeRuntimeEventLifecycle(eventsByType[eventType]).replayToUi).toBe(false);
    }
  });

  it('tool_call_decision 应进入 persist / replay / context', () => {
    const event = createBaseEvent({
      type: 'tool_call_decision',
      id: 'decision_1',
      tool_name: 'web_search',
      tool_call_id: 'call_1',
      phase: 'start',
      status: 'loading',
      args: { query: 'AI' },
      payload: {
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'web_search', arguments: '{"query":"AI"}' },
          },
        ],
      },
    });

    expect(shouldPersistRuntimeEvent(event)).toBe(true);
    expect(shouldReplayRuntimeEventToUi(event)).toBe(true);
    expect(shouldEnterAgentContext(event)).toBe(true);
  });

  it('thought 只进入 UI / 审计投影，不作为独立消息进入模型上下文', () => {
    const foregroundThought = createBaseEvent({
      type: 'thought',
      id: 'foreground-thought',
      content: 'foreground',
      is_complete: true,
    });
    const childThought = routeRuntimeEvent(foregroundThought, {
      run_id: 'run_child',
      parent_run_id: 'run_contract',
      lane: 'child',
      visibility: 'parent-trace',
    });

    expect(shouldPersistRuntimeEvent(foregroundThought)).toBe(true);
    expect(shouldReplayRuntimeEventToUi(foregroundThought)).toBe(true);
    expect(shouldEmitRuntimeEventToSse(foregroundThought)).toBe(true);
    expect(shouldEnterAgentContext(foregroundThought)).toBe(false);

    expect(shouldPersistRuntimeEvent(childThought)).toBe(true);
    expect(shouldReplayRuntimeEventToUi(childThought)).toBe(false);
    expect(shouldEnterAgentContext(childThought)).toBe(false);
  });

  it('run_execution_metrics 应持久化/可回放/实时一致，但不进入 Agent 上下文', () => {
    const event = createBaseEvent({
      type: 'run_execution_metrics',
      id: 'metrics_1',
      execution_id: 'execution_1',
      outcome: 'completed',
      duration_ms: 123,
    });

    expect(shouldPersistRuntimeEvent(event)).toBe(true);
    expect(shouldReplayRuntimeEventToUi(event)).toBe(true);
    expect(shouldEmitRuntimeEventToSse(event)).toBe(true);
    expect(shouldEnterAgentContext(event)).toBe(false);
  });

  it('history_summary 先持久化后仍必须由 EventBus 实时投影同一事实', () => {
    const event = createBaseEvent({
      type: 'history_summary',
      id: 'summary_realtime_1',
      content: 'durable summary',
      original_message_count: 4,
      replaced_message_ids: ['message_1', 'message_2'],
      summary_seq: 1,
    });

    expect(shouldPersistRuntimeEvent(event)).toBe(true);
    expect(shouldReplayRuntimeEventToUi(event)).toBe(true);
    expect(shouldEmitRuntimeEventToSse(event)).toBe(true);
    expect(shouldEnterAgentContext(event)).toBe(true);
  });

  it('context_usage_snapshot 只实时展示，不持久化、回放或进入 Agent 上下文', () => {
    const event = createBaseEvent({
      type: 'context_usage_snapshot',
      id: 'context_usage_1',
      ephemeral: true,
      user_message_id: 'user_1',
      context_usage: {
        basis: 'last_completed_llm_prompt',
        budget_model_id: 'model_1',
        used_tokens: 90,
        components: {
          system_prompt_tokens: 20,
          conversation_tokens: 60,
          tool_definition_tokens: 10,
        },
        component_attribution: 'normalized_local_estimate',
        input_budget_tokens: 100,
        remaining_tokens: 10,
        output_limit_tokens: 20,
        source: 'local-estimate',
        confidence: 'estimate',
        measured_at: 1,
      },
    });

    expect(shouldPersistRuntimeEvent(event)).toBe(false);
    expect(shouldReplayRuntimeEventToUi(event)).toBe(false);
    expect(shouldEmitRuntimeEventToSse(event)).toBe(true);
    expect(shouldEnterAgentContext(event)).toBe(false);
    expect(getRuntimeEventUiProjectionKind(event)).toBe('context_usage_snapshot');
  });

  it('error 应持久化/可回放/可实时展示，但不应进入下一轮 agent 上下文', () => {
    const event = createBaseEvent({
      type: 'error',
      id: 'err_1',
      error: 'LLM request failed',
      error_code: 'llm.provider_down',
      retryable: true,
    });

    expect(shouldPersistRuntimeEvent(event)).toBe(true);
    expect(shouldReplayRuntimeEventToUi(event)).toBe(true);
    expect(shouldEmitRuntimeEventToSse(event)).toBe(true);
    expect(shouldEnterAgentContext(event)).toBe(false);
    expect(getRuntimeEventUiProjectionKind(event)).toBe('error');
  });

  it('final_answer_reset 应为 UI-only：不持久化、不回放、不进上下文，但允许实时 SSE', () => {
    const event = createBaseEvent({
      type: 'final_answer_reset',
      id: 'reset_1',
      ephemeral: true,
      answer_id: 'answer_failed',
      thought_message_ids: ['thought_failed'],
    });

    expect(shouldPersistRuntimeEvent(event)).toBe(false);
    expect(shouldReplayRuntimeEventToUi(event)).toBe(false);
    expect(shouldEmitRuntimeEventToSse(event)).toBe(true);
    expect(shouldEnterAgentContext(event)).toBe(false);
    expect(getRuntimeEventUiProjectionKind(event)).toBe('final_answer_reset');
  });

  it('tool_process 只进入实时 UI：不持久化、不进上下文或历史回放', () => {
    const event = createBaseEvent({
      type: 'tool_process',
      id: 'process_1',
      tool_name: 'web_search',
      tool_call_id: 'call_1',
      phase: 'update',
      status: 'loading',
      args: { query: 'AI' },
      payload: { args: { query: 'AI' } },
    });

    expect(shouldPersistRuntimeEvent(event)).toBe(false);
    expect(shouldReplayRuntimeEventToUi(event)).toBe(false);
    expect(shouldEnterAgentContext(event)).toBe(false);
  });

  it('subrun_trace 固定只实时展示，hidden user_input 仍持久化但不进入上下文', () => {
    const subrunEvent = createBaseEvent({
      type: 'subrun_trace',
      id: 'subrun_1',
      ephemeral: true,
      parent_tool_call_id: 'call_parent',
      subrun_id: 'sub_1',
      source_event_id: 'child_process_1',
      kind: 'tool_process',
      tool_name: 'delegate',
      tool_call_id: 'call_child',
      phase: 'start',
      status: 'loading',
      args: {},
    });
    const hiddenUserInput = createBaseEvent({
      type: 'user_input',
      id: 'hidden_user_1',
      content: '内部推进',
      source: 'user',
      metadata: {
        ui: {
          presentation: 'hidden',
        },
      },
    });

    expect(shouldEnterAgentContext(subrunEvent)).toBe(false);
    expect(shouldPersistRuntimeEvent(subrunEvent)).toBe(false);
    expect(shouldReplayRuntimeEventToUi(subrunEvent)).toBe(false);
    expect(shouldEmitRuntimeEventToSse(subrunEvent)).toBe(true);
    expect(validateRuntimeEvent({ ...subrunEvent, ephemeral: false }).success).toBe(false);
    expect(shouldEnterAgentContext(hiddenUserInput)).toBe(false);
    expect(shouldReplayRuntimeEventToUi(hiddenUserInput)).toBe(false);
    expect(shouldPersistRuntimeEvent(hiddenUserInput)).toBe(true);
  });

  it('final_answer_chunk 应只走实时 SSE，不应进入历史回放', () => {
    const chunkEvent = createBaseEvent({
      type: 'final_answer_chunk',
      id: 'chunk_1',
      answer_id: 'answer_1',
      seq: 0,
      content: 'partial',
      is_last: false,
      ephemeral: true,
    });

    expect(shouldEmitRuntimeEventToSse(chunkEvent)).toBe(true);
    expect(shouldReplayRuntimeEventToUi(chunkEvent)).toBe(false);
    expect(getRuntimeEventUiProjectionKind(chunkEvent)).toBe('final_answer_chunk');
  });

  it('audit_envelope 应只持久化，不进 UI / 上下文 / SSE', () => {
    const event = createBaseEvent({
      type: 'audit_envelope',
      id: 'audit_evt_1',
      envelope: {
        envelopeId: 'audit_1',
        runId: 'run_1',
        ts: 1,
        actor: { kind: 'system' },
        action: 'model.select',
        scope: {
          conversationId: 'conv_contract',
          runId: 'run_1',
          turnId: 'turn_contract',
        },
      },
    });

    expect(shouldPersistRuntimeEvent(event)).toBe(true);
    expect(shouldReplayRuntimeEventToUi(event)).toBe(false);
    expect(shouldEnterAgentContext(event)).toBe(false);
    expect(shouldEmitRuntimeEventToSse(event)).toBe(false);
    expect(getRuntimeEventUiProjectionKind(event)).toBe('audit_envelope');
  });
});
