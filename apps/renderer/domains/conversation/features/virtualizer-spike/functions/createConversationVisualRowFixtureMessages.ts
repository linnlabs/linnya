import type { AnswerMessage, BaseMessage, ThoughtMessage, ToolCallMessage } from '../../../types';
import {
  ConversationTerminalAnswerMessageMetadataSchema,
  ConversationThoughtMessageMetadataSchema,
  ConversationToolMessageMetadataSchema,
  ConversationUserMessageMetadataSchema,
  type JsonValue,
} from '@app/schemas';

const FIXTURE_RUN_ID = 'run_visual-row-fixture';

function answer(id: string, content: string, timestamp: number, turnId: string): AnswerMessage {
  return {
    id,
    role: 'assistant',
    type: 'final_answer',
    content,
    timestamp,
    metadata: ConversationTerminalAnswerMessageMetadataSchema.parse({
      answer_id: id,
      turn_id: turnId,
      run_id: FIXTURE_RUN_ID,
      is_complete: true,
      completion_reason: 'terminal',
      first_token_at: timestamp,
    }),
  };
}

function thought(id: string, content: string, timestamp: number, turnId: string): ThoughtMessage {
  return {
    id,
    role: 'assistant',
    type: 'thought',
    content,
    timestamp,
    metadata: ConversationThoughtMessageMetadataSchema.parse({
      turn_id: turnId,
      run_id: FIXTURE_RUN_ID,
      is_complete: true,
      thought_started_at: timestamp,
      thought_completed_at: timestamp,
    }),
  };
}

function tool(params: {
  readonly id: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly timestamp: number;
  readonly turnId: string;
  readonly args?: Record<string, JsonValue>;
  readonly result?: JsonValue;
  readonly subrunTrace?: Record<string, unknown>;
  readonly subrunTraceVersion?: number;
}): ToolCallMessage {
  return {
    id: params.id,
    role: 'assistant',
    type: 'tool_calls',
    content: '',
    timestamp: params.timestamp,
    metadata: ConversationToolMessageMetadataSchema.parse({
      tool_call_id: params.toolCallId,
      tool_name: params.toolName,
      status: 'success',
      phase: 'complete',
      args: params.args,
      result: params.result,
      turn_id: params.turnId,
      run_id: FIXTURE_RUN_ID,
      started_at: params.timestamp,
      completed_at: params.timestamp,
      subrunTrace: params.subrunTrace,
      subrunTraceVersion: params.subrunTraceVersion,
    }),
  };
}

export function createConversationVisualRowFixtureMessages(): BaseMessage[] {
  return [
    {
      id: 'visual-user-1',
      role: 'user',
      type: 'user_input',
      content: 'Summarize the migration evidence.',
      timestamp: 1,
      metadata: ConversationUserMessageMetadataSchema.parse({
        turn_id: 'turn_visual-user-1',
        run_id: FIXTURE_RUN_ID,
        agent_work: {
          duration_ms: 372_000,
          ended_at: 2,
          outcome: 'completed',
        },
      }),
    },
    answer('visual-answer-1', '# Evidence\n\nCitation [@ab1234]\n\n```ts\nconst stable = true;\n```', 2, 'turn_visual-user-1'),
    ...Array.from({ length: 12 }, (_, index) => thought(
      `visual-transfer-thought-${index + 1}`,
      `Transfer separation ${index + 1}`,
      2.1 + index / 100,
      'turn_visual-user-1',
    )),
    answer('visual-answer-1-terminal', '| Gate | Result |\n| --- | --- |\n| Transfer | Equivalent |\n\n![Fixture](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)', 2.9, 'turn_visual-user-1'),
    {
      id: 'visual-user-2',
      role: 'user',
      type: 'user_input',
      content: 'Run the visual-row task group.',
      timestamp: 3,
    },
    thought('visual-card-thought', 'Checking card grouping and independent measurement.', 5, 'turn_visual-user-2'),
    tool({
      id: 'visual-card-web-search',
      toolCallId: 'visual-web-search-call',
      toolName: 'web_search',
      timestamp: 5.5,
      turnId: 'turn_visual-user-2',
      args: { query: 'A deliberately long query used to verify conversation-column containment' },
      result: {
          data: {
            citations: {
              citations: [
                {
                  docTitle: 'A deliberately long search result title that must remain inside the conversation column even when upstream content has no useful visual breakpoint',
                  url: 'https://example.com/research/this-is-an-intentionally-long-path-without-a-natural-breakpoint-for-the-layout-regression-fixture',
                  snippet: 'External search snippets can be long and unpredictable. The shared tool-message layout must contain this content without creating horizontal overflow or extending beyond the conversation column.',
                  author: 'Fixture Author With A Long Display Name',
                  publishedAt: '2026-07-20',
                },
              ],
            },
          },
      },
    }),
    tool({
      id: 'visual-card-subagent',
      toolCallId: 'visual-subagent-call',
      toolName: 'subagent',
      timestamp: 6,
      turnId: 'turn_visual-user-2',
      args: {
        description: 'Inspect virtual row behavior',
        subagent_type: 'deep_research_scout',
      },
      subrunTraceVersion: 2,
      subrunTrace: {
          'visual-subrun': {
            subrun_id: 'visual-subrun',
            events: [
              {
                type: 'subrun_trace',
                id: 'visual-subrun-process',
                conversation_id: 'visual-row-fixture',
                turn_id: 'turn_visual-user-2',
                timestamp: 7,
                parent_tool_call_id: 'visual-subagent-call',
                subrun_id: 'visual-subrun',
                source_event_id: 'visual-child-process',
                kind: 'tool_process',
                tool_name: 'knowledge_search',
                tool_call_id: 'visual-search-call',
                phase: 'start',
                status: 'loading',
              },
              {
                type: 'subrun_trace',
                id: 'visual-subrun-output',
                conversation_id: 'visual-row-fixture',
                turn_id: 'turn_visual-user-2',
                timestamp: 8,
                parent_tool_call_id: 'visual-subagent-call',
                subrun_id: 'visual-subrun',
                source_event_id: 'visual-child-output',
                kind: 'tool_output',
                tool_name: 'search_knowledge_base',
                tool_call_id: 'visual-search-call',
                status: 'success',
                output: JSON.stringify({ data: { documents: [] } }),
              },
            ],
          },
      },
    }),
    answer('visual-card-answer', '| Gate | Result |\n| --- | --- |\n| Card rows | Independent |\n| Copy | Data-backed |', 9, 'turn_visual-user-2'),
    {
      id: 'visual-user-3',
      role: 'user',
      type: 'user_input',
      content: 'Confirm the final state.',
      timestamp: 10,
    },
    // 尾部必须明显高于 Electron 内容区，确保滚到底后首轮回答在 overscan 外。
    // 这样复制/转存门禁验证的确是“数据层可用、DOM 已卸载”，不受窗口高度影响。
    ...Array.from({ length: 48 }, (_, index) => thought(
      `visual-tail-thought-${index + 1}`,
      `Tail pass ${index + 1}: keeping the earlier answer outside the mounted range.`,
      10.1 + index / 100,
      'turn_visual-user-3',
    )),
    answer('visual-answer-3', 'The isolated canvas remains separate from production.', 11, 'turn_visual-user-3'),
  ];
}
