import { describe, expect, it, vi } from 'vitest';
import {
  createSseSummarizationRealtimePort,
  createSummarizationCallbacks,
} from 'src/app-hosts/linnya/adapters/flow/agent-runner/summarizationEventEmitter';
import { RunIdSchema } from 'linnkit/contracts';

describe('createSummarizationCallbacks', () => {
  it('只通过 realtime port 发出 SSE-only 摘要进度，不发布 durable fact', () => {
    const sink = vi.fn();

    const callbacks = createSummarizationCallbacks({
      conversationId: 'conv_sum',
      turnId: 'turn_sum',
      runId: RunIdSchema.parse('run_sum'),
      executionId: 'execution_sum',
      realtimePort: createSseSummarizationRealtimePort(sink),
    });

    callbacks.onSummarizationStart?.();
    callbacks.onSummarizationEnd?.({
      originalMessageCount: 10,
      summaryEvent: {
        type: 'history_summary',
        id: 'summary_evt_1',
        conversation_id: 'conv_sum',
        turn_id: 'system',
        timestamp: 1,
        version: 1,
        content: 'summary',
        original_message_count: 10,
        compression_ratio: 0.7,
        replaced_message_ids: ['m1', 'm2'],
        summary_seq: 1,
      },
    });

    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[0]?.[0]).toMatchObject({
      type: 'summarization_start',
      conversation_id: 'conv_sum',
      run_id: 'run_sum',
      execution_id: 'execution_sum',
    });
    const summarizationId = sink.mock.calls[0]?.[0].summarization_id;
    expect(sink.mock.calls[1]?.[0]).toMatchObject({
      type: 'summarization_end',
      conversation_id: 'conv_sum',
      summarization_id: summarizationId,
      summary_id: 'summary_evt_1',
      original_message_count: 10,
      compressed_message_count: 1,
      compression_ratio: 0.7,
    });
  });

  it('start 与 error 复用同一 presentation identity，错误事实交给标准执行结算链', () => {
    const sink = vi.fn();
    const callbacks = createSummarizationCallbacks({
      conversationId: 'conv_sum_error',
      turnId: 'turn_sum_error',
      runId: RunIdSchema.parse('run_sum_error'),
      executionId: 'execution_sum_error',
      realtimePort: createSseSummarizationRealtimePort(sink),
    });

    callbacks.onSummarizationStart?.();
    callbacks.onSummarizationError?.(new Error('provider failed'));

    const summarizationId = sink.mock.calls[0]?.[0].summarization_id;
    expect(sink.mock.calls[1]?.[0]).toMatchObject({
      type: 'summarization_error',
      summarization_id: summarizationId,
      error: 'provider failed',
    });
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('realtime transport 失败不得改写 durable 压缩执行语义', () => {
    const callbacks = createSummarizationCallbacks({
      conversationId: 'conv_sum_transport_error',
      turnId: 'turn_sum_transport_error',
      runId: RunIdSchema.parse('run_sum_transport_error'),
      executionId: 'execution_sum_transport_error',
      realtimePort: createSseSummarizationRealtimePort(() => {
        throw new Error('transport closed');
      }),
    });

    expect(() => {
      callbacks.onSummarizationStart?.();
      callbacks.onSummarizationEnd?.({
        originalMessageCount: 1,
        summaryEvent: {
          type: 'history_summary',
          id: 'summary_transport_error',
          conversation_id: 'conv_sum_transport_error',
          turn_id: 'turn_sum_transport_error',
          timestamp: 1,
          version: 1,
          content: 'summary',
          original_message_count: 1,
          replaced_message_ids: ['old_message'],
          summary_seq: 1,
        },
      });
    }).not.toThrow();
  });

  it('presentation 状态异常只记录且不得向执行链抛错', () => {
    const sink = vi.fn();
    const callbacks = createSummarizationCallbacks({
      conversationId: 'conv_sum_state_error',
      turnId: 'turn_sum_state_error',
      runId: RunIdSchema.parse('run_sum_state_error'),
      executionId: 'execution_sum_state_error',
      realtimePort: createSseSummarizationRealtimePort(sink),
    });

    expect(() => callbacks.onSummarizationError?.(new Error('missing start'))).not.toThrow();
    callbacks.onSummarizationStart?.();
    expect(() => callbacks.onSummarizationStart?.()).not.toThrow();
    expect(sink).toHaveBeenCalledTimes(1);
  });

});
