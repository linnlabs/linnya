import { describe, expect, it } from 'vitest';
import type { SSEEvent } from 'linnkit/contracts';
import { conversationMessageIdFromToolIdentity } from '@app/schemas';

import { createInitialProjectionState, reduceEvent } from '../../../services/messageProjection';
import type { BaseMessage, Conversation } from '../../../types';
import { readSubrunTraceBuckets } from '../../subrun-trace';
import {
  createSubrunMessageProjectionState,
  projectSubrunTraceEvent,
} from '../functions/projectSubrunTraceEvent';
import { RunIdSchema, ToolCallIdSchema } from 'linnkit/contracts';

const CONVERSATION_ID = 'conversation-parallel-subruns';
const PARENT_RUN_ID = 'run-parent';
const PARENT_EXECUTION_ID = 'execution-parent';
const PARENT_TOOL_CALL_ID = 'call-subrun-batch';
const SHARED_ANSWER_ID = 'answer-child-local';

function createConversation(): Conversation {
  return {
    id: CONVERSATION_ID,
    title: '并发 child 隔离',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    selectedAgentId: null,
  };
}

function createChildAnswerEvents(
  subrunId: string,
  sourcePrefix: string,
  timestamp: number
): SSEEvent[] {
  const shared = {
    conversation_id: CONVERSATION_ID,
    turn_id: 'turn-parent',
    run_id: RunIdSchema.parse(PARENT_RUN_ID),
    execution_id: PARENT_EXECUTION_ID,
    parent_tool_call_id: ToolCallIdSchema.parse(PARENT_TOOL_CALL_ID),
    subrun_id: subrunId,
  } as const;

  return [
    {
      ...shared,
      type: 'subrun_trace',
      id: `${sourcePrefix}-trace-0`,
      timestamp,
      source_event_id: `${sourcePrefix}-chunk-0`,
      kind: 'final_answer_chunk',
      answer_id: SHARED_ANSWER_ID,
      seq: 0,
      delta: '共同',
    },
    {
      ...shared,
      type: 'subrun_trace',
      id: `${sourcePrefix}-trace-1`,
      timestamp: timestamp + 1,
      source_event_id: `${sourcePrefix}-chunk-1`,
      kind: 'final_answer_chunk',
      answer_id: SHARED_ANSWER_ID,
      seq: 1,
      delta: '答案',
      is_last: true,
    },
    {
      ...shared,
      type: 'subrun_trace',
      id: `${sourcePrefix}-trace-final`,
      timestamp: timestamp + 2,
      source_event_id: `${sourcePrefix}-final`,
      kind: 'final_answer',
      answer_id: SHARED_ANSWER_ID,
      content: '共同答案',
      completion_reason: 'terminal',
    },
  ];
}

function projectChildMessages(
  events: ReturnType<typeof readSubrunTraceBuckets>[string]['events']
): BaseMessage[] {
  const state = createSubrunMessageProjectionState();
  const messages: BaseMessage[] = [];
  events.forEach((event, index) => {
    const result = projectSubrunTraceEvent(state, messages, event, index);
    expect(result.success, result.success ? undefined : result.reason).toBe(true);
  });
  return messages;
}

describe('并发 subrun 主正文与卡片隔离', () => {
  it('两个 child 复用局部答案身份和正文时仍各渲染一次，且不进入 foreground', () => {
    const events: SSEEvent[] = [
      {
        type: 'tool_call_decision',
        id: 'parent-batch-start',
        timestamp: 1,
        conversation_id: CONVERSATION_ID,
        turn_id: 'turn-parent',
        run_id: RunIdSchema.parse(PARENT_RUN_ID),
        execution_id: PARENT_EXECUTION_ID,
        tool_call_id: ToolCallIdSchema.parse(PARENT_TOOL_CALL_ID),
        tool_name: 'subrun_batch',
        phase: 'start',
        status: 'loading',
        args: { description: '并发处理两个子任务' },
      },
      ...createChildAnswerEvents('subrun-a', 'child-a', 2),
      ...createChildAnswerEvents('subrun-b', 'child-b', 5),
      {
        type: 'final_answer_chunk',
        id: 'parent-answer-chunk',
        timestamp: 8,
        conversation_id: CONVERSATION_ID,
        turn_id: 'turn-parent',
        run_id: RunIdSchema.parse(PARENT_RUN_ID),
        execution_id: PARENT_EXECUTION_ID,
        answer_id: 'answer-parent',
        seq: 0,
        chunk: '父任务汇总',
        is_last: true,
      },
      {
        type: 'final_answer',
        id: 'answer-parent',
        timestamp: 9,
        conversation_id: CONVERSATION_ID,
        turn_id: 'turn-parent',
        run_id: RunIdSchema.parse(PARENT_RUN_ID),
        execution_id: PARENT_EXECUTION_ID,
        answer_id: 'answer-parent',
        content: '父任务汇总',
        completion_reason: 'terminal',
      },
    ];

    const projection = createInitialProjectionState(createConversation());
    for (const event of events) {
      const result = reduceEvent(projection, event);
      expect(result.success, result.reason).toBe(true);
    }

    const foregroundAnswers = projection.conversation.messages.filter(
      message => message.type === 'final_answer'
    );
    expect(foregroundAnswers.map(message => message.content)).toEqual(['父任务汇总']);
    expect(projection.conversation.messages.some(message => message.content === '共同答案')).toBe(
      false
    );

    const parentToolMessage = projection.conversation.messages.find(
      message =>
        message.id === conversationMessageIdFromToolIdentity(PARENT_RUN_ID, PARENT_TOOL_CALL_ID)
    );
    if (parentToolMessage?.type !== 'tool_calls') throw new Error('缺少 parent tool message');
    const buckets = readSubrunTraceBuckets(parentToolMessage.metadata.subrunTrace);
    expect(Object.keys(buckets)).toEqual(['subrun-a', 'subrun-b']);

    for (const subrunId of ['subrun-a', 'subrun-b']) {
      const bucket = buckets[subrunId];
      if (!bucket) throw new Error(`缺少 ${subrunId} trace bucket`);
      const childMessages = projectChildMessages(bucket.events);
      expect(childMessages).toHaveLength(1);
      expect(childMessages[0]).toMatchObject({
        type: 'final_answer',
        content: '共同答案',
        metadata: {
          answer_id: SHARED_ANSWER_ID,
          is_complete: true,
          activity: { runId: subrunId, feature: 'subagent_general' },
        },
      });
      expect(childMessages.some(message => message.content === '父任务汇总')).toBe(false);
    }
  });
});
