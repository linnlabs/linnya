import { describe, expect, it } from 'vitest';
import type { SSEEvent } from 'linnkit/contracts';

import type { Conversation } from '../../../types';
import { createInitialProjectionState, reduceEvent } from '..';
import { conversationMessageIdFromToolIdentity } from '@app/schemas';
import { RunIdSchema, ToolCallIdSchema } from 'linnkit/contracts';
import { projectMessageCitationDependencies } from '../../../features/citation-presentation';

const CONVERSATION_ID = 'conversation-concurrent-runs';
const SHARED_TURN_ID = 'turn-shared-local-id';
const RUN_A_ANSWER_ID = 'answer-run-a';
const RUN_B_ANSWER_ID = 'answer-run-b';
const SHARED_TOOL_CALL_ID = 'tool-shared-local-id';

function createConversation(): Conversation {
  return {
    id: CONVERSATION_ID,
    title: '并发运行隔离',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    selectedAgentId: null,
  };
}

function projectAll(events: readonly SSEEvent[]) {
  const state = createInitialProjectionState(createConversation());
  for (const event of events) {
    const result = reduceEvent(state, event);
    expect(result.success, result.reason).toBe(true);
  }
  return state;
}

describe('同一 conversation 的并发 run 投影隔离', () => {
  it('turn 与工具局部 ID 重复时，答案、子 run、reset 与 transport lifecycle 不得跨 run 串线', () => {
    const state = projectAll([
      {
        type: 'tool_call_decision',
        id: 'run-a-tool-start',
        timestamp: 1,
        conversation_id: CONVERSATION_ID,
        turn_id: SHARED_TURN_ID,
        run_id: RunIdSchema.parse('run-a'),
        execution_id: 'execution-a-start',
        tool_call_id: ToolCallIdSchema.parse(SHARED_TOOL_CALL_ID),
        tool_name: 'ask',
        phase: 'start',
        status: 'loading',
        args: { description: 'A 的问题' },
      },
      {
        type: 'tool_call_decision',
        id: 'run-b-tool-start',
        timestamp: 2,
        conversation_id: CONVERSATION_ID,
        turn_id: SHARED_TURN_ID,
        run_id: RunIdSchema.parse('run-b'),
        execution_id: 'execution-b-start',
        tool_call_id: ToolCallIdSchema.parse(SHARED_TOOL_CALL_ID),
        tool_name: 'subagent',
        phase: 'start',
        status: 'loading',
        args: { description: 'B 的任务' },
      },
      {
        type: 'final_answer_chunk',
        id: 'run-a-answer-attempt-1',
        timestamp: 3,
        conversation_id: CONVERSATION_ID,
        turn_id: SHARED_TURN_ID,
        run_id: RunIdSchema.parse('run-a'),
        execution_id: 'execution-a-start',
        answer_id: RUN_A_ANSWER_ID,
        seq: 0,
        chunk: 'A 的失败尝试',
      },
      {
        type: 'final_answer_chunk',
        id: 'run-b-answer-chunk-0',
        timestamp: 4,
        conversation_id: CONVERSATION_ID,
        turn_id: SHARED_TURN_ID,
        run_id: RunIdSchema.parse('run-b'),
        execution_id: 'execution-b-start',
        answer_id: RUN_B_ANSWER_ID,
        seq: 0,
        chunk: 'B 的答案',
        is_last: true,
      },
      {
        type: 'final_answer_reset',
        id: 'run-a-answer-reset',
        timestamp: 5,
        conversation_id: CONVERSATION_ID,
        turn_id: SHARED_TURN_ID,
        run_id: RunIdSchema.parse('run-a'),
        execution_id: 'execution-a-start',
        answer_id: RUN_A_ANSWER_ID,
      },
      {
        type: 'final_answer_chunk',
        id: 'run-a-answer-chunk-0',
        timestamp: 6,
        conversation_id: CONVERSATION_ID,
        turn_id: SHARED_TURN_ID,
        run_id: RunIdSchema.parse('run-a'),
        execution_id: 'execution-a-start',
        answer_id: RUN_A_ANSWER_ID,
        seq: 0,
        chunk: 'A 的答案',
        is_last: true,
      },
      {
        type: 'final_answer',
        id: RUN_A_ANSWER_ID,
        timestamp: 7,
        conversation_id: CONVERSATION_ID,
        turn_id: SHARED_TURN_ID,
        run_id: RunIdSchema.parse('run-a'),
        execution_id: 'execution-a-start',
        answer_id: RUN_A_ANSWER_ID,
        content: 'A 的答案',
        completion_reason: 'terminal',
      },
      {
        type: 'final_answer',
        id: RUN_B_ANSWER_ID,
        timestamp: 8,
        conversation_id: CONVERSATION_ID,
        turn_id: SHARED_TURN_ID,
        run_id: RunIdSchema.parse('run-b'),
        execution_id: 'execution-b-start',
        answer_id: RUN_B_ANSWER_ID,
        content: 'B 的答案',
        completion_reason: 'terminal',
      },
      {
        type: 'subrun_trace',
        id: 'run-a-subrun-trace',
        timestamp: 9,
        conversation_id: CONVERSATION_ID,
        turn_id: SHARED_TURN_ID,
        run_id: RunIdSchema.parse('run-a'),
        execution_id: 'execution-a-start',
        parent_tool_call_id: ToolCallIdSchema.parse(SHARED_TOOL_CALL_ID),
        subrun_id: 'subrun-a',
        source_event_id: 'run-a-child-thought',
        kind: 'thought_delta',
        delta: '只属于 A',
      },
      {
        type: 'transport_end',
        id: 'run-a-start-transport-end',
        timestamp: 10,
        conversation_id: CONVERSATION_ID,
        turn_id: SHARED_TURN_ID,
        run_id: RunIdSchema.parse('run-a'),
        execution_id: 'execution-a-start',
        reason: 'complete',
      },
      {
        type: 'tool_output',
        id: 'run-a-resume-tool-output',
        timestamp: 11,
        conversation_id: CONVERSATION_ID,
        turn_id: SHARED_TURN_ID,
        run_id: RunIdSchema.parse('run-a'),
        execution_id: 'execution-a-resume',
        tool_call_id: ToolCallIdSchema.parse(SHARED_TOOL_CALL_ID),
        tool_name: 'ask',
        status: 'success',
        observation: 'A 已提交',
        data: { submitted: true },
      },
    ]);

    expect(state.conversation.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: RUN_A_ANSWER_ID,
          content: 'A 的答案',
          metadata: expect.objectContaining({ run_id: 'run-a', execution_id: 'execution-a-start' }),
        }),
        expect.objectContaining({
          id: RUN_B_ANSWER_ID,
          content: 'B 的答案',
          metadata: expect.objectContaining({ run_id: 'run-b', execution_id: 'execution-b-start' }),
        }),
      ])
    );
    expect(state.conversation.messages.some(message => message.content === 'A 的失败尝试')).toBe(
      false
    );

    const runATool = state.conversation.messages.find(
      message => message.id === conversationMessageIdFromToolIdentity('run-a', SHARED_TOOL_CALL_ID)
    );
    const runBTool = state.conversation.messages.find(
      message => message.id === conversationMessageIdFromToolIdentity('run-b', SHARED_TOOL_CALL_ID)
    );
    expect(runATool?.metadata).toEqual(
      expect.objectContaining({
        run_id: 'run-a',
        status: 'success',
        subrun_summary: { subrun_ids: ['subrun-a'], event_counts: { 'subrun-a': 1 } },
      })
    );
    expect(runBTool?.metadata).toEqual(
      expect.objectContaining({
        run_id: 'run-b',
        status: 'loading',
      })
    );
    if (runBTool?.type !== 'tool_calls') throw new Error('Expected run B tool message');
    expect(runBTool.metadata.subrunTrace).toBeUndefined();

    expect(state.runStates.get('run-a')?.executionStates.has('execution-a-start')).toBe(false);
    expect(state.runStates.get('run-a')?.executionStates.has('execution-a-resume')).toBe(true);
    expect(state.runStates.get('run-b')?.executionStates.has('execution-b-start')).toBe(true);
  });

  it('tool_process 先于 tool_output 到达时仍修订同一个规范消息实体', () => {
    const state = projectAll([
      {
        type: 'tool_process',
        id: 'ephemeral-process-event',
        timestamp: 1,
        conversation_id: CONVERSATION_ID,
        turn_id: 'turn-process-first',
        run_id: RunIdSchema.parse('run-process-first'),
        execution_id: 'execution-process-first',
        tool_call_id: ToolCallIdSchema.parse('call-process-first'),
        tool_name: 'subagent',
        phase: 'update',
        status: 'loading',
      },
      {
        type: 'tool_output',
        id: 'durable-output-event',
        timestamp: 2,
        conversation_id: CONVERSATION_ID,
        turn_id: 'turn-process-first',
        run_id: RunIdSchema.parse('run-process-first'),
        execution_id: 'execution-process-first',
        tool_call_id: ToolCallIdSchema.parse('call-process-first'),
        tool_name: 'subagent',
        status: 'success',
        observation: '完成',
        data: { completed: true },
      },
    ]);

    expect(state.conversation.messages).toHaveLength(1);
    expect(state.conversation.messages[0]).toMatchObject({
      id: conversationMessageIdFromToolIdentity('run-process-first', 'call-process-first'),
      type: 'tool_calls',
      metadata: {
        status: 'success',
        completed_at: 2,
      },
    });
  });

  it('同一个 execution_id 改绑到另一个 run 必须拒绝，不得污染第二个 run', () => {
    const state = createInitialProjectionState(createConversation());
    const first = reduceEvent(state, {
      type: 'final_answer_chunk',
      id: 'execution-owner-a',
      timestamp: 1,
      conversation_id: CONVERSATION_ID,
      turn_id: 'turn-a',
      run_id: RunIdSchema.parse('run-a'),
      execution_id: 'execution-shared',
      answer_id: 'answer-a',
      seq: 0,
      chunk: 'A',
    });
    expect(first.success).toBe(true);

    const rebound = reduceEvent(state, {
      type: 'final_answer_chunk',
      id: 'execution-owner-b',
      timestamp: 2,
      conversation_id: CONVERSATION_ID,
      turn_id: 'turn-b',
      run_id: RunIdSchema.parse('run-b'),
      execution_id: 'execution-shared',
      answer_id: 'answer-b',
      seq: 0,
      chunk: 'B',
    });

    expect(rebound).toMatchObject({
      success: false,
      reason: 'Execution execution-shared changed run ownership: run-a !== run-b',
    });
    expect(state.runStates.has('run-b')).toBe(false);
    expect(state.conversation.messages.map(message => message.content)).toEqual(['A']);
  });

  it('subrun citation admission 失败时不得追加 trace 事件', () => {
    const state = createInitialProjectionState(createConversation());
    const runId = RunIdSchema.parse('run-subrun-citation');
    const toolCallId = ToolCallIdSchema.parse('call-subrun-citation');
    const decision = reduceEvent(state, {
      type: 'tool_call_decision',
      id: 'subrun-citation-parent',
      timestamp: 1,
      conversation_id: CONVERSATION_ID,
      turn_id: 'turn-subrun-citation',
      run_id: runId,
      execution_id: 'execution-subrun-citation',
      tool_call_id: toolCallId,
      tool_name: 'subagent',
      phase: 'start',
      status: 'loading',
      args: { description: 'citation child run' },
    });
    expect(decision.success).toBe(true);

    const invalidTrace = reduceEvent(state, {
      type: 'subrun_trace',
      id: 'subrun-citation-invalid-output',
      timestamp: 2,
      conversation_id: CONVERSATION_ID,
      turn_id: 'turn-subrun-citation',
      run_id: runId,
      execution_id: 'execution-subrun-citation',
      parent_tool_call_id: toolCallId,
      subrun_id: 'subrun-citation-child',
      source_event_id: 'child-web-search-output',
      kind: 'tool_output',
      tool_name: 'web_search',
      status: 'success',
      output: { hidden_extension: true },
    });

    expect(invalidTrace.success).toBe(false);
    expect(invalidTrace.reason).toContain(
      '[CitationAdmission] tool_name=web_search 的结果不符合正式合同',
    );
    const parent = state.conversation.messages[0];
    if (parent?.type !== 'tool_calls') throw new Error('Expected parent tool message');
    expect(parent.metadata.subrunTrace).toBeUndefined();
    expect(parent.metadata.subrun_summary).toBeUndefined();
    expect(state.processedEvents.has('subrun-citation-invalid-output')).toBe(false);
  });

  it('runtime 从已提交 tool message 重建后仍保留尚未被正文消费的 citation facts', () => {
    const query = 'rebuild citation workspace';
    const state = projectAll([
      {
        type: 'tool_call_decision',
        id: 'citation-rebuild-decision',
        timestamp: 1,
        conversation_id: CONVERSATION_ID,
        turn_id: 'turn-citation-rebuild',
        run_id: RunIdSchema.parse('run-citation-rebuild'),
        execution_id: 'execution-citation-rebuild',
        tool_call_id: ToolCallIdSchema.parse('call-citation-rebuild'),
        tool_name: 'web_search',
        phase: 'start',
        status: 'loading',
        args: { query, top_k: 10 },
      },
      {
        type: 'subrun_trace',
        id: 'citation-rebuild-subrun-output',
        timestamp: 1.5,
        conversation_id: CONVERSATION_ID,
        turn_id: 'turn-citation-child',
        run_id: RunIdSchema.parse('run-citation-rebuild'),
        execution_id: 'execution-citation-rebuild',
        parent_tool_call_id: ToolCallIdSchema.parse('call-citation-rebuild'),
        subrun_id: 'subrun-citation-rebuild',
        source_event_id: 'source-citation-rebuild-subrun-output',
        kind: 'tool_output',
        tool_name: 'web_search',
        tool_call_id: ToolCallIdSchema.parse('call-citation-child'),
        status: 'success',
        output: {
          data: {
            query: 'child rebuild citation',
            resultCount: 1,
            citations: {
              query: 'child rebuild citation',
              searchMode: 'web',
              citations: [{
                sourceType: 'web',
                ref: 'Gh4Jkm',
                index: 1,
                url: 'https://example.com/rebuild-child',
                docTitle: 'rebuild child source',
                snippet: 'rebuild child snippet',
              }],
            },
            evidence_store: { bundle_id: 'bundle-rebuild-child' },
            cacheStatus: 'miss',
          },
          observation: 'child search complete',
        },
      },
      {
        type: 'tool_output',
        id: 'citation-rebuild-output',
        timestamp: 2,
        conversation_id: CONVERSATION_ID,
        turn_id: 'turn-citation-rebuild',
        run_id: RunIdSchema.parse('run-citation-rebuild'),
        execution_id: 'execution-citation-rebuild',
        tool_call_id: ToolCallIdSchema.parse('call-citation-rebuild'),
        tool_name: 'web_search',
        status: 'success',
        observation: 'search complete',
        data: {
          query,
          resultCount: 1,
          citations: {
            query,
            searchMode: 'web',
            citations: [{
              sourceType: 'web',
              ref: 'Ab3Def',
              index: 1,
              url: 'https://example.com/rebuild',
              docTitle: 'rebuild source',
              snippet: 'rebuild snippet',
            }],
          },
          evidence_store: { bundle_id: 'bundle-rebuild' },
          cacheStatus: 'miss',
        },
      },
    ]);

    const rebuilt = createInitialProjectionState(state.conversation);
    expect(projectMessageCitationDependencies(
      rebuilt.citationWorkspace,
      'turn-citation-rebuild',
      'answer [@Ab3Def] child [@Gh4Jkm]',
    )).toEqual({
      citations: [
        expect.objectContaining({
          ref: 'Ab3Def',
          url: 'https://example.com/rebuild',
        }),
        expect.objectContaining({
          ref: 'Gh4Jkm',
          url: 'https://example.com/rebuild-child',
        }),
      ],
      unresolved_refs: [],
    });
  });
});
