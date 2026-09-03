import { describe, expect, it } from 'vitest';
import * as testkit from 'linnkit/testkit';
import { events, execution } from 'linnkit/runtime-kernel';
import { SsePort } from 'src/app-hosts/linnya/adapters/realtime/sse.port';
import { routeRuntimeEvent, validateRuntimeEvent } from 'linnkit/contracts';
import type { RoutedRuntimeEvent, RuntimeEvent, SSEEvent } from 'linnkit/contracts';

function createRuntimeEvent(
  event: Record<string, unknown> & { id: string; type: RuntimeEvent['type'] },
): RoutedRuntimeEvent {
  const candidate = {
    ...event,
    conversation_id: 'conv_lifecycle',
    turn_id: 'turn_lifecycle',
    timestamp: 1,
    version: 1,
  };
  const parsed = validateRuntimeEvent(candidate);
  if (!parsed.success) {
    throw parsed.error;
  }
  return routeRuntimeEvent(parsed.data, {
    run_id: 'run_lifecycle',
    lane: 'foreground',
    visibility: 'conversation',
  });
}

function publishRuntimeEventToSse(event: RoutedRuntimeEvent): SSEEvent[] {
  const received: SSEEvent[] = [];
  const sequencer = new execution.EventSequencer('conv_lifecycle');
  const eventBus = new execution.EventBus(sequencer.getExecutionId());
  const ssePort = new SsePort((sseEvent) => received.push(sseEvent));
  ssePort.connect(eventBus);

  eventBus.publish(sequencer.wrapEvent(event, 'contract'));
  eventBus.close();

  return received;
}

type ContractCase = {
  name: string;
  event: RoutedRuntimeEvent;
  expected: events.RuntimeEventLifecycleDecision;
  realtimeSseType: string | null;
  contextMessageIds: string[];
};

describe('RuntimeEvent lifecycle golden contract', () => {
  const cases: ContractCase[] = [
    {
      name: 'tool_call_decision',
      event: createRuntimeEvent({
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
      }),
      expected: {
        uiProjectionKind: 'tool_call_decision',
        persist: true,
        replayToUi: true,
        enterAgentContext: true,
        realtimeChannel: 'event_bus_sse',
      },
      realtimeSseType: 'tool_call_decision',
      contextMessageIds: ['decision_1'],
    },
    {
      name: 'tool_process',
      event: createRuntimeEvent({
        type: 'tool_process',
        id: 'process_1',
        tool_name: 'web_search',
        tool_call_id: 'call_1',
        phase: 'update',
        status: 'loading',
        args: { query: 'AI' },
      }),
      expected: {
        uiProjectionKind: 'tool_process',
        persist: false,
        replayToUi: false,
        enterAgentContext: false,
        realtimeChannel: 'event_bus_sse',
      },
      realtimeSseType: 'tool_process',
      contextMessageIds: [],
    },
    {
      name: 'tool_output',
      event: createRuntimeEvent({
        type: 'tool_output',
        id: 'tool_output_1',
        tool_name: 'web_search',
        tool_call_id: 'call_1',
        status: 'success',
        observation: '搜索结果',
        data: {},
      }),
      expected: {
        uiProjectionKind: 'tool_output',
        persist: true,
        replayToUi: true,
        enterAgentContext: true,
        realtimeChannel: 'event_bus_sse',
      },
      realtimeSseType: 'tool_output',
      contextMessageIds: ['tool_output_1'],
    },
    {
      name: 'history_summary',
      event: createRuntimeEvent({
        type: 'history_summary',
        id: 'summary_1',
        content: 'summary',
        original_message_count: 4,
        compression_ratio: 0.5,
        replaced_message_ids: ['msg_1', 'msg_2'],
        summary_seq: 1,
      }),
      expected: {
        uiProjectionKind: 'history_summary',
        persist: true,
        replayToUi: true,
        enterAgentContext: true,
        realtimeChannel: 'event_bus_sse',
      },
      realtimeSseType: 'history_summary',
      contextMessageIds: ['summary_1'],
    },
    {
      name: 'hidden user_input',
      event: createRuntimeEvent({
        type: 'user_input',
        id: 'hidden_user_1',
        content: 'internal',
        source: 'user',
        metadata: {
          ui: {
            presentation: 'hidden',
          },
        },
      }),
      expected: {
        uiProjectionKind: 'hidden',
        persist: true,
        replayToUi: false,
        enterAgentContext: false,
        realtimeChannel: 'none',
      },
      realtimeSseType: null,
      contextMessageIds: [],
    },
    {
      name: 'final_answer_chunk',
      event: createRuntimeEvent({
        type: 'final_answer_chunk',
        id: 'chunk_1',
        answer_id: 'answer_1',
        seq: 0,
        content: 'partial',
        is_last: false,
        ephemeral: true,
      }),
      expected: {
        uiProjectionKind: 'final_answer_chunk',
        persist: false,
        replayToUi: false,
        enterAgentContext: false,
        realtimeChannel: 'event_bus_sse',
      },
      realtimeSseType: 'final_answer_chunk',
      contextMessageIds: [],
    },
    {
      name: 'context_usage_snapshot',
      event: createRuntimeEvent({
        type: 'context_usage_snapshot',
        id: 'context_usage_1',
        ephemeral: true,
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
          source: 'test-fixture',
          confidence: 'estimate',
          measured_at: 1,
        },
      }),
      expected: {
        uiProjectionKind: 'context_usage_snapshot',
        persist: false,
        replayToUi: false,
        enterAgentContext: false,
        realtimeChannel: 'event_bus_sse',
      },
      realtimeSseType: 'context_usage_snapshot',
      contextMessageIds: [],
    },
    {
      name: 'run_execution_metrics',
      event: createRuntimeEvent({
        type: 'run_execution_metrics',
        id: 'metrics_1',
        execution_id: 'execution_1',
        outcome: 'completed',
        duration_ms: 123,
      }),
      expected: {
        uiProjectionKind: 'run_execution_metrics',
        persist: true,
        replayToUi: true,
        enterAgentContext: false,
        realtimeChannel: 'event_bus_sse',
      },
      realtimeSseType: 'run_execution_metrics',
      contextMessageIds: [],
    },
  ];

  it.each(cases)('$name 应保持 lifecycle 合同一致', ({ event, expected, realtimeSseType, contextMessageIds }) => {
    expect(events.describeRuntimeEventLifecycle(event)).toEqual(expected);

    const realtimeEvents = publishRuntimeEventToSse(event);
    expect(realtimeEvents.map((item) => item.type)).toEqual(
      realtimeSseType ? [realtimeSseType] : [],
    );

    const harness = testkit.createReplayHarness([event]);
    expect(harness.replay().map((message) => message.id)).toEqual(contextMessageIds);
  });

});
