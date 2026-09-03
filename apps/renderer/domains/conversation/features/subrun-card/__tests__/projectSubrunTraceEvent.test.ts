import { describe, expect, it } from 'vitest';
import type { SSESubRunTraceEvent, SubRunTraceToolCallDecision } from '@linnlabs/linnkit/contracts';

import type { BaseMessage } from '../../../types';
import {
  createSubrunMessageProjectionState,
  projectSubrunTraceEvent,
} from '../functions/projectSubrunTraceEvent';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

function toolDecision(
  toolName: string,
  toolCallId: string,
  args: SubRunTraceToolCallDecision['args']
): SSESubRunTraceEvent {
  return traceEvent('tool_call_decision', {
    tool_calls: [
      {
        tool_name: toolName,
        tool_call_id: ToolCallIdSchema.parse(toolCallId),
        args,
      },
    ],
  });
}

function traceEvent(
  kind: SSESubRunTraceEvent['kind'],
  overrides: Partial<SSESubRunTraceEvent> = {}
): SSESubRunTraceEvent {
  return {
    type: 'subrun_trace',
    id: `trace-${kind}`,
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    timestamp: 100,
    parent_tool_call_id: ToolCallIdSchema.parse('parent-call'),
    subrun_id: 'subrun-1',
    source_event_id: `source-${kind}`,
    kind,
    ...overrides,
  };
}

describe('projectSubrunTraceEvent', () => {
  it('把同一 tool call 的执行与输出合并成一条可展开消息', () => {
    const state = createSubrunMessageProjectionState();
    const messages: BaseMessage[] = [];
    const args = { locator: 'workspace:/doc.md', view: 'document' };

    projectSubrunTraceEvent(state, messages, toolDecision('test_tool', 'call-1', args), 0);
    projectSubrunTraceEvent(
      state,
      messages,
      traceEvent('tool_process', {
        tool_name: 'test_tool',
        tool_call_id: ToolCallIdSchema.parse('call-1'),
        status: 'loading',
        args,
      }),
      1
    );
    projectSubrunTraceEvent(
      state,
      messages,
      traceEvent('tool_output', {
        timestamp: 120,
        tool_name: 'test_tool',
        tool_call_id: ToolCallIdSchema.parse('call-1'),
        status: 'success',
        output: { data: { content: 'done' }, observation: 'done' },
      }),
      2
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'subrun-tool:subrun-1:call-1',
      type: 'tool_calls',
      timestamp: 120,
      metadata: {
        turn_id: 'turn-1',
        status: 'success',
        activity: { runId: 'subrun-1', feature: 'subagent_general' },
      },
    });
  });

  it('缺少正式工具身份时拒绝投影，不按工具名或事件序号补造消息', () => {
    const state = createSubrunMessageProjectionState();
    const messages: BaseMessage[] = [];

    const result = projectSubrunTraceEvent(
      state,
      messages,
      traceEvent('tool_process', {
        tool_name: 'read_file',
        status: 'loading',
      }),
      17
    );

    expect(result).toEqual({
      success: false,
      reason: 'tool_process 缺少正式 tool_name 或 tool_call_id',
    });
    expect(messages).toEqual([]);
  });

  it('保留多个已完成 thought 段落，不让后一个覆盖前一个', () => {
    const state = createSubrunMessageProjectionState();
    const messages: BaseMessage[] = [];

    projectSubrunTraceEvent(
      state,
      messages,
      traceEvent('thought_complete', {
        id: 'thought-1',
        content: '第一段',
        timestamp: 100,
      }),
      0
    );
    projectSubrunTraceEvent(
      state,
      messages,
      traceEvent('thought_complete', {
        id: 'thought-2',
        content: '第二段',
        timestamp: 110,
      }),
      1
    );

    expect(messages.map(message => message.content)).toEqual(['第一段', '第二段']);
    expect(messages.map(message => message.id)).toEqual([
      'subrun_subrun-1_thought_1',
      'subrun_subrun-1_thought_2',
    ]);
  });

  it('按 completion_reason 直接区分工具前播报与终态交付，不依赖未来工具事件改写', () => {
    const state = createSubrunMessageProjectionState();
    const messages: BaseMessage[] = [];

    projectSubrunTraceEvent(
      state,
      messages,
      traceEvent('final_answer_chunk', {
        id: 'trace-preamble-0',
        source_event_id: 'child-preamble-0',
        answer_id: 'answer-preamble',
        seq: 0,
        delta: '我先查询',
        is_last: true,
      }),
      0
    );
    projectSubrunTraceEvent(
      state,
      messages,
      traceEvent('final_answer', {
        id: 'trace-preamble-final',
        source_event_id: 'child-preamble-final',
        answer_id: 'answer-preamble',
        content: '我先查询',
        completion_reason: 'tool_call',
      }),
      1
    );
    expect(messages[0]?.type).toBe('tool_preamble');
    projectSubrunTraceEvent(state, messages, toolDecision('resource_read', 'call-1', {}), 2);
    projectSubrunTraceEvent(
      state,
      messages,
      traceEvent('tool_process', {
        id: 'trace-tool',
        source_event_id: 'child-tool',
        tool_name: 'resource_read',
        tool_call_id: ToolCallIdSchema.parse('call-1'),
        status: 'loading',
        args: {},
      }),
      3
    );
    projectSubrunTraceEvent(
      state,
      messages,
      traceEvent('final_answer_chunk', {
        id: 'trace-delivery-1',
        source_event_id: 'child-delivery-1',
        answer_id: 'answer-delivery',
        seq: 1,
        delta: '答案',
      }),
      4
    );
    projectSubrunTraceEvent(
      state,
      messages,
      traceEvent('final_answer_chunk', {
        id: 'trace-delivery-0',
        source_event_id: 'child-delivery-0',
        answer_id: 'answer-delivery',
        seq: 0,
        delta: '最终',
        is_last: true,
      }),
      5
    );
    projectSubrunTraceEvent(
      state,
      messages,
      traceEvent('final_answer', {
        id: 'trace-delivery-final',
        source_event_id: 'child-delivery-final',
        answer_id: 'answer-delivery',
        content: '最终答案',
        completion_reason: 'terminal',
      }),
      6
    );

    expect(messages).toMatchObject([
      {
        id: 'subrun_subrun-1_answer_answer-preamble',
        type: 'tool_preamble',
        content: '我先查询',
        metadata: {
          answer_id: 'answer-preamble',
          completion_reason: 'tool_call',
        },
      },
      {
        id: 'subrun-tool:subrun-1:call-1',
        type: 'tool_calls',
      },
      {
        id: 'subrun_subrun-1_answer_answer-delivery',
        type: 'final_answer',
        content: '最终答案',
        metadata: {
          answer_id: 'answer-delivery',
          seal_source_event_id: 'child-delivery-final',
          completion_reason: 'terminal',
          is_complete: true,
        },
      },
    ]);
  });

  it('同一 seq 的重复 trace 不重复正文，不同 answer_id 即使文本相同也保持隔离', () => {
    const state = createSubrunMessageProjectionState();
    const messages: BaseMessage[] = [];

    for (const answerId of ['answer-a', 'answer-b']) {
      projectSubrunTraceEvent(
        state,
        messages,
        traceEvent('final_answer_chunk', {
          id: `trace-${answerId}`,
          source_event_id: `source-${answerId}`,
          answer_id: answerId,
          seq: 0,
          delta: '相同文本',
        }),
        0
      );
    }
    projectSubrunTraceEvent(
      state,
      messages,
      traceEvent('final_answer_chunk', {
        id: 'trace-answer-b-duplicate',
        source_event_id: 'source-answer-b-duplicate',
        answer_id: 'answer-b',
        seq: 0,
        delta: '相同文本',
      }),
      1
    );

    expect(messages.map(message => message.content)).toEqual(['相同文本', '相同文本']);
    expect(
      messages.map(message => {
        if (message.type !== 'final_answer') throw new Error('Expected subrun answer message');
        return message.metadata.answer_id;
      })
    ).toEqual(['answer-a', 'answer-b']);
  });

  it('完整答案缺少对应 chunk 或正文不一致时拒绝补造第二事实源', () => {
    const state = createSubrunMessageProjectionState();
    const messages: BaseMessage[] = [];

    const missing = projectSubrunTraceEvent(
      state,
      messages,
      traceEvent('final_answer', {
        answer_id: 'answer-missing',
        content: '不能补造',
      }),
      0
    );
    projectSubrunTraceEvent(
      state,
      messages,
      traceEvent('final_answer_chunk', {
        answer_id: 'answer-mismatch',
        seq: 0,
        delta: '流式正文',
      }),
      1
    );
    const mismatch = projectSubrunTraceEvent(
      state,
      messages,
      traceEvent('final_answer', {
        answer_id: 'answer-mismatch',
        content: '另一份正文',
      }),
      2
    );

    expect(missing).toMatchObject({ success: false });
    expect(mismatch).toMatchObject({ success: false });
    expect(messages.map(message => message.content)).toEqual(['流式正文']);
  });
});
