import { describe, expect, it, vi } from 'vitest';
import { execution } from '@linnlabs/linnkit/runtime-kernel';
import { SsePort } from '../sse.port';
import { routeRuntimeEvent, validateRuntimeEvent } from '@linnlabs/linnkit/contracts';
import type { EventEnvelope, RoutedRuntimeEvent, RuntimeEvent, SSEEvent } from '@linnlabs/linnkit/contracts';

function createRuntimeEvent(
  event: Record<string, unknown> & { id: string; type: RuntimeEvent['type'] },
): RoutedRuntimeEvent {
  const candidate = {
    ...event,
    conversation_id: 'conv_sse',
    turn_id: 'turn_sse',
    timestamp: 1,
    version: 1,
  };
  const parsed = validateRuntimeEvent(candidate);
  if (!parsed.success) {
    throw parsed.error;
  }
  return routeRuntimeEvent(parsed.data, {
    run_id: parsed.data.run_id ?? 'run_sse',
    parent_run_id: parsed.data.parent_run_id,
    lane: parsed.data.lane ?? 'foreground',
    visibility: parsed.data.visibility ?? 'conversation',
  });
}

describe('SsePort runtime UI governance', () => {
  function publishAndCollect(
    event: RoutedRuntimeEvent,
    renderHint?: EventEnvelope<RoutedRuntimeEvent>['render_hint'],
  ): SSEEvent[] {
    const received: SSEEvent[] = [];
    const sequencer = new execution.EventSequencer('conv_sse');
    const eventBus = new execution.EventBus(sequencer.getExecutionId());
    const ssePort = new SsePort((sseEvent) => received.push(sseEvent));
    ssePort.connect(eventBus);

    eventBus.publish(sequencer.wrapEvent(event, 'test', { renderHint }));
    eventBus.close();

    return received;
  }

  function publishSequenceAndCollect(events: readonly RoutedRuntimeEvent[]): SSEEvent[] {
    const received: SSEEvent[] = [];
    const sequencer = new execution.EventSequencer('conv_sse');
    const eventBus = new execution.EventBus(sequencer.getExecutionId());
    const ssePort = new SsePort((sseEvent) => received.push(sseEvent));
    ssePort.connect(eventBus);

    for (const event of events) {
      eventBus.publish(sequencer.wrapEvent(event, 'test'));
    }
    eventBus.close();

    return received;
  }

  it('应跳过 hidden user_input 的实时 SSE', () => {
    const event = createRuntimeEvent({
      type: 'user_input',
      id: 'hidden_user_1',
      content: 'internal',
      source: 'user',
      metadata: {
        ui: {
          presentation: 'hidden',
        },
      },
    });

    expect(publishAndCollect(event)).toEqual([]);
  });

  it('durable history_summary 应通过同一 EventBus 进入实时投影', () => {
    const event = createRuntimeEvent({
      type: 'history_summary',
      id: 'summary_1',
      content: 'summary',
      original_message_count: 3,
      compression_ratio: 0.5,
      replaced_message_ids: ['msg_1', 'msg_2'],
      summary_seq: 1,
    });

    expect(publishAndCollect(event)).toEqual([
      expect.objectContaining({
        type: 'history_summary',
        id: 'summary_1',
        summary_id: 'summary_1',
        run_id: 'run_sse',
      }),
    ]);
  });

  it('应继续发送 tool_output 的实时 SSE', () => {
    const event = createRuntimeEvent({
      type: 'tool_output',
      id: 'tool_output_1',
      tool_name: 'web_search',
      tool_call_id: 'call_1',
      status: 'success',
      observation: 'ok',
      data: {},
    });

    const received = publishAndCollect(event);
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('tool_output');
  });

  it('应从 RuntimeEvent 正式字段投影 run 路由身份', () => {
    const event = createRuntimeEvent({
      type: 'tool_output',
      id: 'tool_output_routed',
      tool_name: 'web_search',
      tool_call_id: 'call_routed',
      status: 'success',
      observation: 'ok',
      data: {},
      run_id: 'run-routed',
      parent_run_id: 'run-parent',
      lane: 'child',
      visibility: 'parent-trace',
    });

    expect(publishAndCollect(event)).toEqual([
      expect.objectContaining({
        run_id: 'run-routed',
        lane: 'child',
        visibility: 'parent-trace',
      }),
    ]);
  });

  it('前置事件不得覆盖 final_answer_chunk 自身从零开始的答案序号', () => {
    const thought = createRuntimeEvent({
      type: 'thought',
      id: 'thought_before_answer',
      thought_message_id: 'thought_message_1',
      content: 'thinking',
      is_complete: true,
    });
    const firstChunk = createRuntimeEvent({
      type: 'final_answer_chunk',
      id: 'answer_chunk_0',
      answer_id: 'answer_1',
      seq: 0,
      content: 'hello',
      is_last: false,
      ephemeral: true,
    });
    const secondChunk = createRuntimeEvent({
      type: 'final_answer_chunk',
      id: 'answer_chunk_1',
      answer_id: 'answer_1',
      seq: 1,
      content: ' world',
      is_last: true,
      ephemeral: true,
    });

    const received = publishSequenceAndCollect([thought, firstChunk, secondChunk]);
    const chunks = received.filter(event => event.type === 'final_answer_chunk');

    expect(chunks).toEqual([
      expect.objectContaining({
        id: 'answer_chunk_0',
        seq: 0,
        execution_seq: 2,
        chunk: 'hello',
      }),
      expect.objectContaining({
        id: 'answer_chunk_1',
        seq: 1,
        execution_seq: 3,
        chunk: ' world',
      }),
    ]);
  });

  it('应通过官方 RuntimeEvent 投影发送 requires_user_interaction', () => {
    const event = createRuntimeEvent({
      type: 'requires_user_interaction',
      id: 'wait_user_1',
      interaction_id: 'interaction_1',
      run_id: 'run_1',
      tool_call_id: 'tool_call_1',
      checkpoint_revision: 4,
      resume_token: 'resume_1',
      interaction_status: 'pending',
      form: { fields: [] },
      interaction_type: 'confirm',
      prompt: '继续？',
    });

    expect(publishAndCollect(event)).toEqual([
      expect.objectContaining({
        type: 'requires_user_interaction',
        id: 'wait_user_1',
        interaction_id: 'interaction_1',
        run_id: 'run_1',
        tool_call_id: 'tool_call_1',
        checkpoint_revision: 4,
        resume_token: 'resume_1',
        interaction_status: 'pending',
        form: { fields: [] },
        interaction_type: 'confirm',
        prompt: '继续？',
      }),
    ]);
  });

  it('应保留宿主 render_hint enrichment', () => {
    const toolEvent = createRuntimeEvent({
      type: 'tool_process',
      id: 'tool_process_with_hint',
      tool_name: 'web_search',
      tool_call_id: 'call_hint',
      phase: 'update',
      status: 'loading',
      meta: { display: 'compact' },
    });
    const finalAnswerEvent = createRuntimeEvent({
      type: 'final_answer',
      id: 'answer_hint',
      answer_id: 'answer_hint',
      content: 'done',
      completion_reason: 'terminal',
      meta: { source: 'llm' },
    });

    expect(publishAndCollect(toolEvent, { content: 'markdown', card: 'collapsible' })[0]).toMatchObject({
      type: 'tool_process',
      meta: {
        display: 'compact',
        render_hint: { content: 'markdown', card: 'collapsible' },
      },
    });
    expect(publishAndCollect(finalAnswerEvent, { content: 'markdown' })[0]).toMatchObject({
      type: 'final_answer',
      meta: {
        source: 'llm',
        render_hint: { content: 'markdown' },
        stream_completed: true,
      },
    });
  });

  it('应允许注入自定义 realtime mapper', () => {
    const event = createRuntimeEvent({
      type: 'tool_output',
      id: 'tool_output_custom_mapper',
      tool_name: 'web_search',
      tool_call_id: 'call_custom',
      status: 'success',
      observation: 'ok',
      data: {},
    });

    const received: SSEEvent[] = [];
    const sequencer = new execution.EventSequencer('conv_sse');
    const eventBus = new execution.EventBus(sequencer.getExecutionId());
    const customMapper = {
      mapToSse: vi.fn(() => [
        {
          type: 'transport_end',
          id: 'transport_end_custom',
          timestamp: 1,
          conversation_id: 'conv_sse',
          turn_id: 'turn_sse',
          execution_id: sequencer.getExecutionId(),
          reason: 'complete',
        } satisfies SSEEvent,
      ]),
    };
    const ssePort = new SsePort({
      sink: (sseEvent) => received.push(sseEvent),
      runtimeEventMapper: customMapper,
    });

    ssePort.connect(eventBus);
    eventBus.publish(sequencer.wrapEvent(event, 'test'));

    expect(customMapper.mapToSse).toHaveBeenCalledTimes(1);
    expect(received).toEqual([
      expect.objectContaining({
        type: 'transport_end',
        id: 'transport_end_custom',
      }),
    ]);
  });
});
