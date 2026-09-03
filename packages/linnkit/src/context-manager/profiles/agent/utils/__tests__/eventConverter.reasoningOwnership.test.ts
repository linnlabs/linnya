import { describe, expect, it } from 'vitest';
import {
  createFinalAnswerEvent,
  createThoughtEvent,
  createToolCallDecisionEvent,
  createToolOutputEvent,
  createUserInputEvent,
  type RuntimeEvent,
} from '../../../../../contracts';
import { formatAgentLlmMessages } from '../../../../shared';
import { convertEventsToAiMessages } from '../eventConverter';

describe('agent context reasoning ownership', () => {
  it('多段 canonical reasoning 只通过 ordered replay 进入模型上下文', () => {
    const replayParts = [
      { type: 'reasoning' as const, text: '先整理证据。' },
      { type: 'reasoning' as const, text: '再组织最终回答。' },
      { type: 'text' as const, text: '最终回答。' },
    ];
    const events: RuntimeEvent[] = [
      createThoughtEvent('terminal_thought', 'c1', 't1', '先整理证据。\n再组织最终回答。', {
        is_complete: true,
      }),
      createFinalAnswerEvent('terminal_answer', 'c1', 't1', '最终回答。', {
        completion_reason: 'terminal',
        assistant_replay_parts: replayParts,
      }),
    ];

    const messages = convertEventsToAiMessages(events);
    const llmMessages = formatAgentLlmMessages(messages);

    expect(messages.map(message => message.id)).toEqual(['terminal_answer']);
    expect(llmMessages).toEqual([{
      role: 'assistant',
      content: '最终回答。',
      assistant_replay_parts: replayParts,
    }]);
  });

  it('没有 ordered replay owner 的 thought 也只服务 UI / 审计', () => {
    const events: RuntimeEvent[] = [
      createThoughtEvent('standalone_thought', 'c1', 't1', '这是一条独立思考。', {
        is_complete: true,
      }),
      createFinalAnswerEvent('plain_answer', 'c1', 't1', '普通回答。', {
        completion_reason: 'terminal',
      }),
    ];

    const messages = convertEventsToAiMessages(events);

    expect(messages.map(message => message.id)).toEqual(['plain_answer']);
  });

  it('同一 turn 连续工具循环只在既有 Context 尾部追加新消息', () => {
    const firstReplayParts = [
      { type: 'reasoning' as const, text: '先读取。' },
      { type: 'tool_call' as const, tool_call_id: 'call_first' },
    ];
    const firstEvents: RuntimeEvent[] = [
      createUserInputEvent('user_cache', 'c1', 't1', '完成任务'),
      createThoughtEvent('thought_first', 'c1', 't1', '先读取。', { is_complete: true }),
      createToolCallDecisionEvent('decision_first', 'c1', 't1', 'workspace_read', 'call_first', {
        payload: {
          assistant_replay_parts: firstReplayParts,
          tool_calls: [{
            id: 'call_first',
            type: 'function',
            function: { name: 'workspace_read', arguments: '{}' },
          }],
        },
      }),
      createToolOutputEvent('output_first', 'c1', 't1', 'workspace_read', 'call_first', {
        status: 'success',
        observation: '读取完成',
        data: {},
      }),
    ];
    const secondReplayParts = [
      { type: 'reasoning' as const, text: '再写入。' },
      { type: 'tool_call' as const, tool_call_id: 'call_second' },
    ];
    const secondEvents: RuntimeEvent[] = [
      ...firstEvents,
      createThoughtEvent('thought_second', 'c1', 't1', '再写入。', { is_complete: true }),
      createToolCallDecisionEvent('decision_second', 'c1', 't1', 'workspace_write', 'call_second', {
        payload: {
          assistant_replay_parts: secondReplayParts,
          tool_calls: [{
            id: 'call_second',
            type: 'function',
            function: { name: 'workspace_write', arguments: '{}' },
          }],
        },
      }),
      createToolOutputEvent('output_second', 'c1', 't1', 'workspace_write', 'call_second', {
        status: 'success',
        observation: '写入完成',
        data: {},
      }),
    ];

    const firstMessages = convertEventsToAiMessages(firstEvents);
    const secondMessages = convertEventsToAiMessages(secondEvents);

    expect(firstMessages.map(message => message.id)).toEqual([
      'user_cache',
      'decision_first',
      'output_first',
    ]);
    expect(secondMessages.slice(0, firstMessages.length)).toEqual(firstMessages);
    expect(secondMessages.map(message => message.id)).toEqual([
      'user_cache',
      'decision_first',
      'output_first',
      'decision_second',
      'output_second',
    ]);
    expect(secondMessages[1]?.metadata?.assistant_replay_parts).toEqual(firstReplayParts);
    expect(secondMessages[3]?.metadata?.assistant_replay_parts).toEqual(secondReplayParts);
  });
});
