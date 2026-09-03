import { describe, expect, it } from 'vitest';

import type { SSEEvent } from '../index';
import {
  RuntimeEvent,
  createContextUsageSnapshotEvent,
  createErrorEvent,
  createFinalAnswerChunkEvent,
  createFinalAnswerEvent,
  createFinalAnswerResetEvent,
  createHistorySummaryEvent,
  createRunExecutionMetricsEvent,
  createSubRunTraceEvent,
  createThoughtEvent,
  createToolCallDecisionEvent,
  createToolOutputEvent,
  createToolProcessEvent,
  createUserInputEvent,
  runtimeEventToSSEEvent,
  validateSSEEvent,
} from '../index';
import { RunIdSchema, ToolCallIdSchema } from '..';

function expectValidSSE(event: RuntimeEvent): SSEEvent {
  const sseEvent = runtimeEventToSSEEvent(event);
  expect(sseEvent).not.toBeNull();
  const parsed = validateSSEEvent(sseEvent);
  expect(parsed.success).toBe(true);
  if (!parsed.success) {
    throw new Error('SSE validation failed');
  }
  return parsed.data;
}

describe('runtimeEventToSSEEvent', () => {
  it('保留 subrun decision 的 canonical tool_calls 批次', () => {
    const decision = createSubRunTraceEvent(
      'subrun_decision_evt',
      'conv_1',
      'child_turn_1',
      'parent_call',
      'subrun_1',
      'tool_call_decision',
      {
        source_event_id: 'child_decision_evt',
        tool_calls: [{
          tool_call_id: ToolCallIdSchema.parse('child_call'),
          tool_name: 'lookup',
          args: { query: 'canonical batch' },
        }],
      },
    );

    const projected = expectValidSSE(decision);
    expect(projected).toMatchObject({
      type: 'subrun_trace',
      kind: 'tool_call_decision',
      tool_calls: [{
        tool_call_id: 'child_call',
        tool_name: 'lookup',
        args: { query: 'canonical batch' },
      }],
    });
  });

  it('摘要 presentation 使用稳定身份、正式 scope 和 snake_case 统计字段', () => {
    const canonical = {
      type: 'summarization_start',
      id: 'summarization-1',
      summarization_id: 'summarization-1',
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      run_id: 'run-1',
      execution_id: 'execution-1',
      timestamp: 1,
    };
    expect(validateSSEEvent(canonical).success).toBe(true);
    expect(
      validateSSEEvent({
        ...canonical,
        summarization_id: 'summarization-2',
      }).success
    ).toBe(false);
    expect(
      validateSSEEvent({
        ...canonical,
        type: 'summarization_end',
        id: 'summarization-end-1',
        originalMessages: 8,
        compressedMessages: 1,
        compressionRatio: '50%',
      }).success
    ).toBe(false);
    expect(
      validateSSEEvent({
        ...canonical,
        type: 'summarization_end',
        id: 'summarization-end-1',
        summary_id: 'history-summary-1',
        original_message_count: 8,
        compressed_message_count: 1,
        compression_ratio: 0.5,
      }).success
    ).toBe(true);
  });

  it('所有有实时 UI 语义的 RuntimeEvent 分支都能投影为合法 SSEEvent', () => {
    const events: RuntimeEvent[] = [
      createThoughtEvent('thought_evt', 'conv_1', 'turn_1', 'thinking', {
        is_complete: false,
        delta: 'thin',
      }),
      createToolCallDecisionEvent('decision_evt', 'conv_1', 'turn_1', 'lookup', 'call_1', {
        phase: 'start',
        status: 'loading',
        args: { q: 'linnkit' },
        payload: { args: { q: 'linnkit' } },
        meta: { display: 'compact' },
      }),
      createToolProcessEvent('process_evt', 'conv_1', 'turn_1', 'lookup', 'call_1', {
        phase: 'update',
        status: 'loading',
        args: { q: 'linnkit' },
        payload: { progress: 0.5 },
        meta: { ephemeral: true },
      }),
      createToolOutputEvent(
        'output_evt',
        'conv_1',
        'turn_1',
        'lookup',
        'call_1',
        { status: 'success', observation: 'lookup done', data: { ok: true } },
        {
          duration_ms: 12,
        }
      ),
      createSubRunTraceEvent(
        'subrun_evt',
        'conv_1',
        'turn_1',
        'parent_call',
        'subrun_1',
        'tool_output',
        {
          source_event_id: 'child_output_evt',
          tool_name: 'child_lookup',
          tool_call_id: ToolCallIdSchema.parse('child_call'),
          status: 'success',
          output: { child: true },
          attachments: [{
            id: 'child-image-attachment',
            kind: 'image',
            resourceId: 'child-image-asset',
            mediaType: 'image/png',
            byteLength: 128,
            width: 16,
            height: 8,
            sha256: 'a'.repeat(64),
          }],
        }
      ),
      {
        type: 'requires_user_interaction',
        id: 'wait_evt',
        conversation_id: 'conv_1',
        turn_id: 'turn_1',
        timestamp: 1,
        version: 1,
        form: { fields: [] },
        interaction_type: 'confirm',
        prompt: 'continue?',
        interaction_id: 'wait_evt',
        run_id: RunIdSchema.parse('run_1'),
        tool_call_id: ToolCallIdSchema.parse('call_1'),
        checkpoint_revision: 2,
        resume_token: 'resume_1',
        interaction_status: 'pending',
      },
      createFinalAnswerEvent('answer_1', 'conv_1', 'turn_1', 'done', {
        completion_reason: 'terminal',
        meta: { source: 'llm' },
      }),
      createFinalAnswerChunkEvent(
        'chunk_evt',
        'conv_1',
        'turn_1',
        'answer_1',
        2,
        'partial answer',
        {
          is_last: true,
        }
      ),
      createFinalAnswerResetEvent('reset_evt', 'conv_1', 'turn_1', {
        answer_id: 'answer_failed',
        thought_message_ids: ['thought_failed'],
      }),
      createHistorySummaryEvent(
        'summary_evt',
        'conv_1',
        'turn_1',
        'summary text',
        ['msg_1', 'msg_2'],
        2,
        3
      ),
      createErrorEvent('error_evt', 'conv_1', 'turn_1', 'boom', {
        details: { code: 'E_TEST' },
        error_code: 'engine.unknown',
        retryable: false,
      }),
      createContextUsageSnapshotEvent(
        'context_usage_evt',
        'conv_1',
        'turn_1',
        {
          basis: 'last_completed_llm_prompt',
          budget_model_id: 'primary-model',
          used_tokens: 850,
          components: {
            system_prompt_tokens: 200,
            conversation_tokens: 550,
            tool_definition_tokens: 100,
          },
          component_attribution: 'normalized_local_estimate',
          input_budget_tokens: 1_000,
          remaining_tokens: 150,
          output_limit_tokens: 200,
          source: 'local-estimate',
          confidence: 'estimate',
          measured_at: 1_220,
        },
        { user_message_id: 'user_1' },
      ),
      createRunExecutionMetricsEvent('metrics_evt', 'conv_1', 'turn_1', {
        execution_id: 'execution_1',
        outcome: 'completed',
        duration_ms: 123,
        user_message_id: 'user_1',
        context_usage: {
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
          source: 'provider-preflight-count',
          confidence: 'provider-estimate',
          measured_at: 1_230,
        },
      }),
    ];

    expect(events.map(event => expectValidSSE(event).type)).toEqual([
      'thought',
      'tool_call_decision',
      'tool_process',
      'tool_output',
      'subrun_trace',
      'requires_user_interaction',
      'final_answer',
      'final_answer_chunk',
      'final_answer_reset',
      'history_summary',
      'error',
      'context_usage_snapshot',
      'run_execution_metrics',
    ]);
  });

  it('context usage snapshot 保持 ephemeral 并原样通过严格 SSE admission', () => {
    const runtimeEvent = createContextUsageSnapshotEvent(
      'context_usage_live',
      'conv_1',
      'turn_1',
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
        source: 'provider-preflight-count',
        confidence: 'provider-estimate',
        measured_at: 1_230,
      },
      { user_message_id: 'user_1' },
    );

    expect(runtimeEvent.ephemeral).toBe(true);
    expect(expectValidSSE(runtimeEvent)).toMatchObject({
      type: 'context_usage_snapshot',
      user_message_id: 'user_1',
      context_usage: runtimeEvent.context_usage,
    });
    expect(RuntimeEvent.safeParse({ ...runtimeEvent, ephemeral: false }).success).toBe(false);
  });

  it('run execution metrics 的 context usage 原样通过严格 SSE admission', () => {
    const runtimeEvent = createRunExecutionMetricsEvent('metrics_usage', 'conv_1', 'turn_1', {
      execution_id: 'execution_1',
      outcome: 'completed',
      duration_ms: 123,
      user_message_id: 'user_1',
      context_usage: {
        basis: 'last_completed_llm_prompt',
        budget_model_id: 'primary-model',
        served_model_id: 'fallback-model',
        used_tokens: 1_100,
        components: {
          system_prompt_tokens: 200,
          conversation_tokens: 750,
          tool_definition_tokens: 150,
        },
        component_attribution: 'normalized_local_estimate',
        input_budget_tokens: 1_000,
        remaining_tokens: -100,
        output_limit_tokens: 200,
        source: 'local-estimate',
        confidence: 'estimate',
        measured_at: 1_230,
      },
    });

    const projected = expectValidSSE(runtimeEvent);
    expect(projected).toMatchObject({
      type: 'run_execution_metrics',
      context_usage: runtimeEvent.context_usage,
    });
    expect(validateSSEEvent({
      ...projected,
      context_usage: {
        ...runtimeEvent.context_usage,
        remaining_tokens: 0,
      },
    }).success).toBe(false);
  });

  it('把 RuntimeEvent final_answer_chunk.content 投影为 SSE chunk', () => {
    const runtimeEvent = createFinalAnswerChunkEvent(
      'evt_chunk',
      'conv_1',
      'turn_1',
      'answer_1',
      2,
      'partial answer',
      { is_last: true }
    );

    expect(expectValidSSE(runtimeEvent)).toMatchObject({
      type: 'final_answer_chunk',
      id: 'evt_chunk',
      answer_id: 'answer_1',
      seq: 2,
      chunk: 'partial answer',
      is_last: true,
    });
  });

  it('把 RuntimeEvent history_summary 投影为 SSE summary DTO', () => {
    const runtimeEvent = createHistorySummaryEvent(
      'summary_evt',
      'conv_1',
      'turn_1',
      'summary text',
      ['msg_1', 'msg_2'],
      2,
      3
    );

    expect(expectValidSSE(runtimeEvent)).toMatchObject({
      type: 'history_summary',
      id: 'summary_evt',
      summary_id: 'summary_evt',
      content: 'summary text',
      replaced_message_ids: ['msg_1', 'msg_2'],
      original_message_count: 2,
      summary_seq: 3,
    });

    const { original_message_count: _originalMessageCount, ...missingCount } = runtimeEvent;
    expect(RuntimeEvent.safeParse(missingCount).success).toBe(false);
  });

  it('拒绝缺少正式工具身份或状态的 subrun trace', () => {
    const valid = createSubRunTraceEvent(
      'subrun_evt',
      'conv_1',
      'turn_1',
      'parent_call',
      'subrun_1',
      'tool_process',
      {
        source_event_id: 'child_tool_evt',
        tool_name: 'lookup',
        tool_call_id: ToolCallIdSchema.parse('child_call'),
        phase: 'update',
        status: 'loading',
        args: { query: 'owner admitted' },
      }
    );

    expect(validateSSEEvent(runtimeEventToSSEEvent(valid)).success).toBe(true);
    expect(
      validateSSEEvent({
        ...runtimeEventToSSEEvent(valid),
        tool_call_id: undefined,
      }).success
    ).toBe(false);
    expect(
      validateSSEEvent({
        ...runtimeEventToSSEEvent(valid),
        tool_name: '   ',
      }).success
    ).toBe(false);
    expect(
      validateSSEEvent({
        ...runtimeEventToSSEEvent(valid),
        status: undefined,
      }).success
    ).toBe(false);
  });

  it('保留 tool_process 的 args/payload/meta 字段形态', () => {
    const runtimeEvent = createToolProcessEvent(
      'tool_evt',
      'conv_1',
      'turn_1',
      'lookup',
      'call_1',
      {
        phase: 'update',
        status: 'loading',
        args: { q: 'linnkit' },
        payload: { progress: 0.5 },
        meta: { ephemeral: true },
      }
    );

    expect(expectValidSSE(runtimeEvent)).toMatchObject({
      type: 'tool_process',
      tool_name: 'lookup',
      tool_call_id: 'call_1',
      args: { q: 'linnkit' },
      payload: { progress: 0.5 },
      meta: { ephemeral: true },
    });
  });

  it('对没有实时 UI 语义的 RuntimeEvent 返回 null', () => {
    const runtimeEvent = createUserInputEvent('user_evt', 'conv_1', 'turn_1', 'hello');

    expect(runtimeEventToSSEEvent(runtimeEvent)).toBeNull();
  });
});
