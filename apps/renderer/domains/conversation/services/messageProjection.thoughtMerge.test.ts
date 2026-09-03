/**
 * @file apps/renderer/domains/conversation/services/messageProjection.thoughtMerge.test.ts
 * @description
 * 修复回归测试：COT 模型 + 工具调用打断后补发 complete thought，不应在前端渲染出两条 thought。
 *
 * 根因：
 * - thought 增量事件的 event.id 必须“每个 chunk 一个新 id”（否则会被 processedEvents 去重丢弃）
 * - 但 thought 的“消息归并”不能用 event.id，否则 complete thought（通常用另一套 id）会被当成新消息
 *
 * 方案：
 * - 使用 thought_message_id 作为“稳定的消息归并 ID”
 * - event.id 仍然只用于事件幂等去重
 */

import { describe, it, expect } from 'vitest';
import type { Conversation } from '../types';
import { createInitialProjectionState, reduceEvent } from './messageProjection';
import type { SSEToolCallDecisionEvent, SSEThoughtEvent } from '@linnlabs/linnkit/contracts';
import { PROJECTION_TEST_SCOPE } from './messageProjection/__tests__/helpers/projectionTestScope';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

describe('messageProjection - thought_message_id 归并', () => {
  it('工具调用打断 thought 后补发 complete thought，应更新同一条 thought 而不是新建', () => {
    const conversation: Conversation = {
      id: 'conv_test_thought_merge',
      title: 'test',
      titleOrigin: 'explicit',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      selectedAgentId: null,
    };

    const turnId = 'turn_1';
    const conversationId = conversation.id;

    const thoughtMessageId = 'thought_msg_1';

    const deltaEvent: SSEThoughtEvent = {
      ...PROJECTION_TEST_SCOPE,
      type: 'thought',
      id: 'evt_thought_delta_1',
      conversation_id: conversationId,
      turn_id: turnId,
      timestamp: 1,
      thought_message_id: thoughtMessageId,
      delta: '思考中...',
      is_complete: false,
    };

    const actionEvent: SSEToolCallDecisionEvent = {
      ...PROJECTION_TEST_SCOPE,
      type: 'tool_call_decision',
      id: 'evt_decision_1',
      conversation_id: conversationId,
      turn_id: turnId,
      timestamp: 2,
      tool_name: 'edit_file',
      tool_call_id: ToolCallIdSchema.parse('tool_call_1'),
      phase: 'start',
      status: 'loading',
      args: { foo: 'bar' },
      payload: { args: { foo: 'bar' } },
      meta: { ephemeral: true },
    };

    const completeEvent: SSEThoughtEvent = {
      ...PROJECTION_TEST_SCOPE,
      type: 'thought',
      // complete thought 的 event.id 允许不同于 delta（甚至可能等于 thought_message_id）
      id: thoughtMessageId,
      conversation_id: conversationId,
      turn_id: turnId,
      timestamp: 3,
      thought_message_id: thoughtMessageId,
      content: '思考中...（完成）',
      is_complete: true,
    };

    // 依次投影：delta -> tool_call_decision -> complete
    const s0 = createInitialProjectionState(conversation);

    const r1 = reduceEvent(s0, deltaEvent);
    expect(r1.success).toBe(true);
    const s1 = r1.newState!;
    expect(s1.conversation.messages).toHaveLength(1);
    expect(s1.conversation.messages[0]?.type).toBe('thought');
    expect(s1.conversation.messages[0]?.id).toBe(thoughtMessageId);

    const r2 = reduceEvent(s1, actionEvent);
    expect(r2.success).toBe(true);
    const s2 = r2.newState!;
    expect(s2.conversation.messages).toHaveLength(2);
    expect(s2.conversation.messages[1]?.type).toBe('tool_calls');

    const r3 = reduceEvent(s2, completeEvent);
    expect(r3.success).toBe(true);
    const s3 = r3.newState!;

    // ✅ 不应新增第二条 thought
    expect(s3.conversation.messages).toHaveLength(2);
    const thoughtMsg = s3.conversation.messages[0];
    expect(thoughtMsg?.type).toBe('thought');
    expect(thoughtMsg?.id).toBe(thoughtMessageId);
    expect(thoughtMsg?.content).toBe('思考中...（完成）');
  });

  it('连续 Thought 的身份变化必须开启新段，不能把完成态 metadata 回写成 streaming', () => {
    const conversation: Conversation = {
      id: 'conv_test_thought_segments',
      title: 'test',
      titleOrigin: 'explicit',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      selectedAgentId: null,
    };
    const common = {
      ...PROJECTION_TEST_SCOPE,
      type: 'thought' as const,
      conversation_id: conversation.id,
      turn_id: 'turn_segments',
    };
    const events: SSEThoughtEvent[] = [
      {
        ...common,
        id: 'evt_segment_a_complete',
        timestamp: 1,
        thought_message_id: 'thought_segment_a',
        content: '第一段思考完成。',
        is_complete: true,
        metadata: { thought_started_at: 0, thought_completed_at: 1 },
      },
      {
        ...common,
        id: 'evt_segment_b_delta',
        timestamp: 2,
        thought_message_id: 'thought_segment_b',
        delta: '第二段思考开始',
        is_complete: false,
        metadata: { thought_started_at: 2 },
      },
      {
        ...common,
        id: 'evt_segment_b_complete',
        timestamp: 3,
        thought_message_id: 'thought_segment_b',
        content: '第二段思考完成。',
        is_complete: true,
        metadata: { thought_started_at: 2, thought_completed_at: 3 },
      },
    ];

    let state = createInitialProjectionState(conversation);
    for (const event of events) {
      const result = reduceEvent(state, event);
      expect(result.success, result.reason).toBe(true);
      if (!result.newState) throw new Error('Thought projection did not return state');
      state = result.newState;
    }

    expect(state.conversation.messages).toMatchObject([
      {
        id: 'thought_segment_a',
        type: 'thought',
        content: '第一段思考完成。',
        metadata: { is_complete: true, thought_completed_at: 1 },
      },
      {
        id: 'thought_segment_b',
        type: 'thought',
        content: '第二段思考完成。',
        metadata: { is_complete: true, thought_completed_at: 3 },
      },
    ]);
  });
});
