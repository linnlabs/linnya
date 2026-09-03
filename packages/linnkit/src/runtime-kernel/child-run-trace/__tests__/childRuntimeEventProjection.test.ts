import { describe, expect, it } from 'vitest';

import {
  routeRuntimeEvent,
  runtimeEventToSSEEvent,
  validateRuntimeEvent,
  validateSSEEvent,
  type RoutedRuntimeEvent,
  type RuntimeResourceRef,
  type RuntimeEvent,
  ToolCallIdSchema,
} from '../../../contracts';
import { projectChildRuntimeEventToSubRunTrace } from '../projectChildRuntimeEventToSubRunTrace';
import { RuntimeEventSubRunTracePublisher } from '../runtimeEventSubRunTracePublisher';

const childIdentity = {
  run_id: 'child-run-1',
  parent_run_id: 'parent-run-1',
  lane: 'child' as const,
  visibility: 'parent-trace' as const,
};

const imageRef: RuntimeResourceRef = {
  id: 'child-image-attachment',
  kind: 'image',
  resourceId: 'child-image-asset',
  mediaType: 'image/png',
  byteLength: 128,
  width: 16,
  height: 8,
  sha256: 'a'.repeat(64),
  fileName: 'slide-001.png',
};

function childEvent(event: RuntimeEvent): RoutedRuntimeEvent {
  return routeRuntimeEvent(event, childIdentity);
}

describe('child RuntimeEvent -> parent subrun trace', () => {
  it('把一次 decision 的完整工具批次保留为一个 durable parent trace fact', () => {
    const decision = childEvent({
      type: 'tool_call_decision',
      id: 'child-decision-1',
      conversation_id: 'conversation-1',
      turn_id: 'child-turn-1',
      timestamp: 1,
      version: 1,
      tool_name: 'read_file',
      tool_call_id: ToolCallIdSchema.parse('call-read'),
      phase: 'start',
      status: 'loading',
      payload: {
        tool_calls: [
          {
            id: 'call-read',
            type: 'function',
            function: { name: 'read_file', arguments: '{"locator":"workspace:/a.md"}' },
          },
          {
            id: 'call-search',
            type: 'function',
            function: { name: 'grep', arguments: '{"locator":"workspace:/","pattern":"P0"}' },
          },
        ],
      },
    });

    expect(projectChildRuntimeEventToSubRunTrace(decision)).toEqual({
      kind: 'tool_call_decision',
      source_event_id: 'child-decision-1',
      tool_calls: [
        {
          tool_call_id: 'call-read',
          tool_name: 'read_file',
          args: { locator: 'workspace:/a.md' },
        },
        {
          tool_call_id: 'call-search',
          tool_name: 'grep',
          args: { locator: 'workspace:/', pattern: 'P0' },
        },
      ],
    });
  });

  it('多个答案段经同一纯投影保留 source identity、answer identity 与答案内序号', () => {
    const sourceEvents = [
      childEvent({
        type: 'final_answer_chunk',
        id: 'chunk-a-0',
        conversation_id: 'conversation-1',
        turn_id: 'child-turn-1',
        timestamp: 1,
        version: 1,
        answer_id: 'answer-a',
        seq: 0,
        content: '工具前说明',
      }),
      childEvent({
        type: 'final_answer',
        id: 'answer-a',
        conversation_id: 'conversation-1',
        turn_id: 'child-turn-1',
        timestamp: 2,
        version: 1,
        answer_id: 'answer-a',
        content: '工具前说明',
        completion_reason: 'tool_call',
        is_complete: true,
      }),
      childEvent({
        type: 'final_answer_chunk',
        id: 'chunk-b-0',
        conversation_id: 'conversation-1',
        turn_id: 'child-turn-1',
        timestamp: 3,
        version: 1,
        answer_id: 'answer-b',
        seq: 0,
        content: '最终交付',
        is_last: true,
      }),
      childEvent({
        type: 'final_answer',
        id: 'answer-b',
        conversation_id: 'conversation-1',
        turn_id: 'child-turn-1',
        timestamp: 4,
        version: 1,
        answer_id: 'answer-b',
        content: '最终交付',
        completion_reason: 'terminal',
        is_complete: true,
      }),
    ];

    expect(sourceEvents.map(projectChildRuntimeEventToSubRunTrace)).toEqual([
      {
        kind: 'final_answer_chunk',
        source_event_id: 'chunk-a-0',
        answer_id: 'answer-a',
        seq: 0,
        delta: '工具前说明',
      },
      {
        kind: 'final_answer',
        source_event_id: 'answer-a',
        answer_id: 'answer-a',
        content: '工具前说明',
        completion_reason: 'tool_call',
      },
      {
        kind: 'final_answer_chunk',
        source_event_id: 'chunk-b-0',
        answer_id: 'answer-b',
        seq: 0,
        delta: '最终交付',
        is_last: true,
      },
      {
        kind: 'final_answer',
        source_event_id: 'answer-b',
        answer_id: 'answer-b',
        content: '最终交付',
        completion_reason: 'terminal',
      },
    ]);
  });

  it('成功 child tool_output 把 durable attachment refs 原样投影到 Runtime 与 SSE trace', () => {
    const output = childEvent({
      type: 'tool_output',
      id: 'child-image-output',
      conversation_id: 'conversation-1',
      turn_id: 'child-turn-1',
      timestamp: 2,
      version: 1,
      tool_name: 'read_file',
      tool_call_id: ToolCallIdSchema.parse('call-read-image'),
      status: 'success',
      observation: '图片已读取。',
      data: { content_type: 'image/png' },
      attachments: [imageRef],
    });
    const trace = projectChildRuntimeEventToSubRunTrace(output);
    expect(trace).toMatchObject({
      kind: 'tool_output',
      source_event_id: 'child-image-output',
      status: 'success',
      attachments: [imageRef],
    });
    if (!trace) throw new Error('successful child tool output should produce a trace');

    const published: RuntimeEvent[] = [];
    const publisher = new RuntimeEventSubRunTracePublisher({
      runtimeEventSink: event => {
        published.push(event);
        return routeRuntimeEvent(event, {
          run_id: 'parent-run-1',
          lane: 'foreground',
          visibility: 'conversation',
        });
      },
      conversationId: 'conversation-1',
      turnId: 'parent-turn-1',
      parentToolCallId: ToolCallIdSchema.parse('parent-tool-call-1'),
      subrunId: 'child-run-1',
    });
    publisher.publish(trace);

    const publishedTrace = published[0];
    if (!publishedTrace) throw new Error('parent trace publisher should emit one runtime event');
    expect(publishedTrace).toMatchObject({ attachments: [imageRef] });
    expect(runtimeEventToSSEEvent(publishedTrace)).toMatchObject({
      type: 'subrun_trace',
      attachments: [imageRef],
    });
  });

  it('把已提交的 child 摘要投影为不含正文的 parent trace 展示事实', () => {
    const summary = childEvent({
      type: 'history_summary',
      id: 'child-summary-1',
      conversation_id: 'conversation-1',
      turn_id: 'child-turn-1',
      timestamp: 5,
      version: 1,
      content: 'child 内部上下文摘要正文',
      replaced_message_ids: ['child-tool-output-1'],
      original_message_count: 4,
      summary_seq: 1,
      compression_ratio: 0.25,
      included_old_summary: false,
    });

    expect(projectChildRuntimeEventToSubRunTrace(summary)).toEqual({
      kind: 'history_summary',
      source_event_id: 'child-summary-1',
      original_message_count: 4,
      replaced_message_ids: ['child-tool-output-1'],
      compression_ratio: 0.25,
      included_old_summary: false,
    });
  });

  it('publisher 生成的 Runtime/SSE trace 共用正式 source 与答案字段', () => {
    const published: RuntimeEvent[] = [];
    const publisher = new RuntimeEventSubRunTracePublisher({
      runtimeEventSink: event => {
        published.push(event);
        return routeRuntimeEvent(event, {
          run_id: 'parent-run-1',
          lane: 'foreground',
          visibility: 'conversation',
        });
      },
      conversationId: 'conversation-1',
      turnId: 'parent-turn-1',
      parentToolCallId: ToolCallIdSchema.parse('parent-tool-call-1'),
      subrunId: 'child-run-1',
    });

    publisher.publish({
      kind: 'final_answer_chunk',
      source_event_id: 'child-chunk-0',
      answer_id: 'child-answer-1',
      seq: 0,
      delta: '交付',
      is_last: true,
    });
    publisher.publish({
      kind: 'final_answer',
      source_event_id: 'child-answer-1',
      answer_id: 'child-answer-1',
      content: '交付',
      completion_reason: 'terminal',
    });
    publisher.publish({
      kind: 'history_summary',
      source_event_id: 'child-summary-1',
      original_message_count: 4,
      replaced_message_ids: ['child-tool-output-1'],
      compression_ratio: 0.25,
      included_old_summary: false,
    });

    expect(published).toHaveLength(3);
    for (const event of published) {
      expect(validateRuntimeEvent(event).success).toBe(true);
      const sse = runtimeEventToSSEEvent(event);
      expect(validateSSEEvent(sse).success).toBe(true);
    }
    expect(published).toMatchObject([
      {
        type: 'subrun_trace',
        source_event_id: 'child-chunk-0',
        answer_id: 'child-answer-1',
        seq: 0,
        is_last: true,
      },
      {
        type: 'subrun_trace',
        source_event_id: 'child-answer-1',
        answer_id: 'child-answer-1',
      },
      {
        type: 'subrun_trace',
        source_event_id: 'child-summary-1',
        kind: 'history_summary',
        original_message_count: 4,
        replaced_message_ids: ['child-tool-output-1'],
        compression_ratio: 0.25,
        included_old_summary: false,
      },
    ]);
  });

  it('不会把 child 执行指标投影成父工具卡内容', () => {
    const childMetrics = childEvent({
      type: 'run_execution_metrics',
      id: 'child-metrics-1',
      conversation_id: 'conversation-1',
      turn_id: 'child-turn-1',
      timestamp: 1,
      version: 1,
      execution_id: 'child-execution-1',
      outcome: 'completed',
      duration_ms: 10,
      user_message_id: 'child-user-1',
    });

    expect(projectChildRuntimeEventToSubRunTrace(childMetrics)).toBeNull();
  });

  it('共享协议拒绝缺 source identity 或答案归并字段的 trace', () => {
    const base = {
      type: 'subrun_trace',
      id: 'trace-1',
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      timestamp: 1,
      version: 1,
      ephemeral: true,
      parent_tool_call_id: 'parent-call-1',
      subrun_id: 'child-run-1',
      kind: 'final_answer_chunk',
      delta: '正文',
    };

    expect(validateRuntimeEvent(base).success).toBe(false);
    expect(validateRuntimeEvent({ ...base, source_event_id: 'chunk-1' }).success).toBe(false);
    expect(
      validateSSEEvent({
        ...base,
        source_event_id: 'chunk-1',
        answer_id: 'answer-1',
      }).success
    ).toBe(false);
  });

  it('共享协议只允许成功 tool_output 携带 attachments', () => {
    const base = {
      type: 'subrun_trace',
      id: 'trace-image-1',
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      timestamp: 1,
      version: 1,
      ephemeral: true,
      parent_tool_call_id: 'parent-call-1',
      subrun_id: 'child-run-1',
      source_event_id: 'child-image-output',
      attachments: [imageRef],
    };
    expect(validateRuntimeEvent({
      ...base,
      kind: 'tool_output',
      tool_name: 'read_file',
      tool_call_id: 'child-read-call',
      status: 'success',
      output: { data: { content_type: 'image/png' } },
    }).success).toBe(true);
    expect(validateRuntimeEvent({
      ...base,
      kind: 'tool_output',
      tool_name: 'read_file',
      tool_call_id: 'child-read-call',
      status: 'error',
      output: { error: 'failed' },
    }).success).toBe(false);
    expect(validateRuntimeEvent({
      ...base,
      kind: 'thought_complete',
      content: 'done',
    }).success).toBe(false);
  });
});
