import { describe, expect, it } from 'vitest';

import type { ToolCallMessage } from '../../../types';
import { createTestAnswerMessage } from '../../../testing/functions/createConversationTestMessage';
import {
  projectSubrunDetailMessages,
  projectSubrunInvocationMessage,
} from './projectSubrunDetailMessages';

function parentMessage(): ToolCallMessage {
  return {
    id: 'message-parent-subagent',
    role: 'assistant',
    type: 'tool_calls',
    content: '',
    timestamp: 12,
    metadata: {
      tool_call_id: 'call-parent-subagent',
      tool_name: 'subagent',
      status: 'loading',
      phase: 'start',
      args: {
        description: '读取报告',
        prompt: '读取 ESG 报告并总结关键结论',
      },
      turn_id: 'turn-parent',
      run_id: 'run-parent',
      started_at: 12,
    },
  };
}

describe('projectSubrunDetailMessages', () => {
  it('把正式 subagent prompt 投影为稳定身份的只读 user message', () => {
    expect(projectSubrunInvocationMessage({
      parentMessage: parentMessage(),
      subrunId: 'subrun-child',
    })).toEqual({
      id: 'subrun-user:subrun-child',
      role: 'user',
      type: 'user_input',
      content: '读取 ESG 报告并总结关键结论',
      timestamp: 12,
      metadata: {
        activity: {
          runId: 'subrun-child',
          feature: 'subagent_general',
        },
      },
    });
  });

  it('调用 prompt 是 child 视觉轮次的第一条消息', () => {
    const answer = createTestAnswerMessage({ id: 'child-answer' });
    expect(projectSubrunDetailMessages({
      parentMessage: parentMessage(),
      subrunId: 'subrun-child',
      childMessages: [answer],
    }).map(message => message.id)).toEqual([
      'subrun-user:subrun-child',
      'child-answer',
    ]);
  });
});
