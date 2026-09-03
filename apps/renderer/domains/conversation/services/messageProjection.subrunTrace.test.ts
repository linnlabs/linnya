import { describe, expect, it } from 'vitest';
import type { Conversation } from '../types';
import { createInitialProjectionState, reduceEvent } from './messageProjection';
import { isRecord } from '../utils/typeGuards';
import type { SSESubRunTraceEvent, SSEToolCallDecisionEvent } from '@linnlabs/linnkit/contracts';
import { PROJECTION_TEST_SCOPE } from './messageProjection/__tests__/helpers/projectionTestScope';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { registerToolPresentationProjectionPort } from '../ports/toolPresentationProjectionPort';
import { projectSingleSubrunPresentation } from '../features/subrun-card/functions/projectSingleSubrunPresentation';

describe('messageProjection - subrun_trace object replacement', () => {
  it('首个 child trace 在同一提交中补齐 single presentation，冲突 child 不留下半更新', () => {
    const unregister = registerToolPresentationProjectionPort({
      project(request) {
        if (request.sourceToolName !== 'subagent') return undefined;
        const projection = projectSingleSubrunPresentation({ ...request, uiKey: 'subagent' });
        return {
          uiKey: 'subagent',
          status: request.status,
          phase: request.phase,
          ...projection,
        };
      },
    });
    try {
      const conversation: Conversation = {
        id: 'conv_single_presentation',
        title: 'single presentation',
        titleOrigin: 'explicit',
        createdAt: 1,
        updatedAt: 1,
        messages: [],
        selectedAgentId: null,
      };
      const decision: SSEToolCallDecisionEvent = {
        ...PROJECTION_TEST_SCOPE,
        type: 'tool_call_decision',
        id: 'decision-single-presentation',
        conversation_id: conversation.id,
        turn_id: 'turn-single',
        timestamp: 1,
        tool_name: 'subagent',
        tool_call_id: ToolCallIdSchema.parse('call-single'),
        phase: 'start',
        status: 'loading',
        args: { description: '读取资料', prompt: '读取并整理资料' },
        payload: { args: { description: '读取资料', prompt: '读取并整理资料' } },
      };
      const trace = (subrunId: string, timestamp: number): SSESubRunTraceEvent => ({
        ...PROJECTION_TEST_SCOPE,
        type: 'subrun_trace',
        id: `trace-${subrunId}`,
        conversation_id: conversation.id,
        turn_id: 'turn-single',
        timestamp,
        parent_tool_call_id: ToolCallIdSchema.parse('call-single'),
        subrun_id: subrunId,
        source_event_id: `source-${subrunId}`,
        kind: 'thought_delta',
        delta: '处理中',
      });

      const state = createInitialProjectionState(conversation);
      expect(reduceEvent(state, decision).success).toBe(true);
      expect(reduceEvent(state, trace('subrun-a', 2)).success).toBe(true);
      const afterFirst = state.conversation.messages[0];
      if (afterFirst?.type !== 'tool_calls') throw new Error('Expected tool message');
      expect(afterFirst.toolPresentation?.data).toMatchObject({ subrunId: 'subrun-a' });
      expect(afterFirst.metadata.subrunTraceVersion).toBe(1);

      const conflict = trace('subrun-b', 3);
      expect(reduceEvent(state, conflict)).toMatchObject({
        success: false,
        reason: expect.stringContaining('[SUBRUN_SINGLE_IDENTITY_CARDINALITY]'),
      });
      const afterConflict = state.conversation.messages[0];
      if (afterConflict?.type !== 'tool_calls') throw new Error('Expected tool message');
      expect(afterConflict.metadata.subrun_summary?.subrun_ids).toEqual(['subrun-a']);
      expect(afterConflict.metadata.subrunTraceVersion).toBe(1);
      expect(state.processedEvents.has(conflict.id)).toBe(false);
    } finally {
      unregister();
    }
  });

  it('subrun_trace 挂载到 tool_calls 时，应替换消息对象并递增 subrunTraceVersion', () => {
    const conversation: Conversation = {
      id: 'conv_test_subrun_trace',
      title: 'test',
      titleOrigin: 'explicit',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      selectedAgentId: null,
    };

    const toolCallDecision: SSEToolCallDecisionEvent = {
      ...PROJECTION_TEST_SCOPE,
      type: 'tool_call_decision',
      id: 'evt_tool_call_decision_1',
      conversation_id: conversation.id,
      turn_id: 'turn_1',
      timestamp: 1,
      tool_name: 'subagent',
      tool_call_id: ToolCallIdSchema.parse('tool_call_delegate_1'),
      phase: 'start',
      status: 'loading',
      args: {
        description: '子任务',
      },
      payload: {
        args: {
          description: '子任务',
        },
      },
      meta: {},
    };

    const subrunTrace: SSESubRunTraceEvent = {
      ...PROJECTION_TEST_SCOPE,
      type: 'subrun_trace',
      id: 'evt_subrun_trace_1',
      conversation_id: conversation.id,
      turn_id: 'turn_1',
      timestamp: 2,
      parent_tool_call_id: ToolCallIdSchema.parse('tool_call_delegate_1'),
      subrun_id: 'subrun_1',
      source_event_id: 'child-thought-1',
      kind: 'thought_delta',
      delta: '正在搜索资料',
    };

    const s0 = createInitialProjectionState(conversation);
    const r1 = reduceEvent(s0, toolCallDecision);
    expect(r1.success).toBe(true);
    const s1 = r1.newState!;
    const toolMessageBefore = s1.conversation.messages[0];
    expect(toolMessageBefore?.type).toBe('tool_calls');

    const r2 = reduceEvent(s1, subrunTrace);
    expect(r2.success).toBe(true);
    const s2 = r2.newState!;
    const toolMessageAfter = s2.conversation.messages[0];

    expect(toolMessageAfter).not.toBe(toolMessageBefore);
    if (toolMessageAfter?.type !== 'tool_calls') throw new Error('Expected projected tool message');
    expect(toolMessageAfter.metadata.subrunTraceVersion).toBe(1);
    expect(toolMessageAfter.metadata.subrun_summary).toEqual({
      subrun_ids: ['subrun_1'],
      event_counts: { subrun_1: 1 },
    });
  });

  it('batched tool_call_decision 在 replay 时，应为每个 subagent 子调用建立锚点并允许各自挂载 subrun_trace', () => {
    const conversation: Conversation = {
      id: 'conv_test_subrun_trace_batch',
      title: 'test',
      titleOrigin: 'explicit',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      selectedAgentId: null,
    };

    const toolCalls = [
      {
        id: 'tool_call_delegate_1',
        type: 'function' as const,
        function: {
          name: 'subagent',
          arguments: JSON.stringify({ description: '子任务 1', prompt: '执行子任务 1' }),
        },
      },
      {
        id: 'tool_call_delegate_2',
        type: 'function' as const,
        function: {
          name: 'subagent',
          arguments: JSON.stringify({ description: '子任务 2', prompt: '执行子任务 2' }),
        },
      },
      {
        id: 'tool_call_delegate_3',
        type: 'function' as const,
        function: {
          name: 'subagent',
          arguments: JSON.stringify({ description: '子任务 3', prompt: '执行子任务 3' }),
        },
      },
    ];

    const toolCallDecision: SSEToolCallDecisionEvent = {
      ...PROJECTION_TEST_SCOPE,
      type: 'tool_call_decision',
      id: 'evt_tool_call_decision_batch',
      conversation_id: conversation.id,
      turn_id: 'turn_batch',
      timestamp: 1,
      tool_name: 'subagent',
      tool_call_id: ToolCallIdSchema.parse('tool_call_delegate_1'),
      phase: 'start',
      status: 'loading',
      args: {
        description: '子任务 1',
        prompt: '执行子任务 1',
      },
      payload: {
        args: {
          description: '子任务 1',
          prompt: '执行子任务 1',
        },
        tool_calls: toolCalls,
      },
      meta: {
        tool_call_ids: toolCalls.map(call => call.id),
        tool_batch_size: toolCalls.length,
      },
    };

    const traces: SSESubRunTraceEvent[] = [
      {
        ...PROJECTION_TEST_SCOPE,
        type: 'subrun_trace',
        id: 'evt_subrun_trace_batch_1',
        conversation_id: conversation.id,
        turn_id: 'turn_batch',
        timestamp: 2,
        parent_tool_call_id: ToolCallIdSchema.parse('tool_call_delegate_1'),
        subrun_id: 'subrun_1',
        source_event_id: 'child-batch-thought-1',
        kind: 'thought_delta',
        delta: '子任务 1 正在执行',
      },
      {
        ...PROJECTION_TEST_SCOPE,
        type: 'subrun_trace',
        id: 'evt_subrun_trace_batch_2',
        conversation_id: conversation.id,
        turn_id: 'turn_batch',
        timestamp: 3,
        parent_tool_call_id: ToolCallIdSchema.parse('tool_call_delegate_2'),
        subrun_id: 'subrun_2',
        source_event_id: 'child-batch-thought-2',
        kind: 'thought_delta',
        delta: '子任务 2 正在执行',
      },
      {
        ...PROJECTION_TEST_SCOPE,
        type: 'subrun_trace',
        id: 'evt_subrun_trace_batch_3',
        conversation_id: conversation.id,
        turn_id: 'turn_batch',
        timestamp: 4,
        parent_tool_call_id: ToolCallIdSchema.parse('tool_call_delegate_3'),
        subrun_id: 'subrun_3',
        source_event_id: 'child-batch-thought-3',
        kind: 'thought_delta',
        delta: '子任务 3 正在执行',
      },
    ];

    let state = createInitialProjectionState(conversation);
    const decisionResult = reduceEvent(state, toolCallDecision);
    expect(decisionResult.success).toBe(true);
    state = decisionResult.newState!;

    for (const trace of traces) {
      const r = reduceEvent(state, trace);
      expect(r.success).toBe(true);
      state = r.newState!;
    }

    const toolMessages = state.conversation.messages.filter(msg => msg.type === 'tool_calls');
    expect(toolMessages).toHaveLength(3);

    const descriptions = toolMessages.map(msg => {
      const meta = isRecord(msg.metadata) ? msg.metadata : undefined;
      const args = meta && isRecord(meta['args']) ? meta['args'] : undefined;
      return typeof args?.['description'] === 'string' ? args['description'] : undefined;
    });
    expect(descriptions).toEqual(['子任务 1', '子任务 2', '子任务 3']);

    const traceVersions = toolMessages.map(msg => {
      const meta = isRecord(msg.metadata) ? msg.metadata : undefined;
      return typeof meta?.['subrunTraceVersion'] === 'number' ? meta['subrunTraceVersion'] : 0;
    });
    expect(traceVersions).toEqual([1, 1, 1]);
  });
});
