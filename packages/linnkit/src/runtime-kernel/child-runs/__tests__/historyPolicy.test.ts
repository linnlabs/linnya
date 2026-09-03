import { describe, expect, it } from 'vitest';
import type { RuntimeEvent, RuntimeResourceRef } from '../../../contracts';
import { pickChildRunSeedHistory } from '../historyPolicy';
import { RunIdSchema, ToolCallIdSchema } from '../../../contracts';

const imageRef: RuntimeResourceRef = {
  id: 'attachment-parent-1',
  kind: 'image',
  resourceId: 'asset-parent-1',
  mediaType: 'image/png',
  byteLength: 128,
  width: 16,
  height: 8,
  sha256: 'a'.repeat(64),
};

function createParentHistory(): RuntimeEvent[] {
  return [
    {
      type: 'user_input',
      id: 'parent-user-1',
      timestamp: 1,
      turn_id: 'parent-turn-1',
      conversation_id: 'parent-conversation',
      version: 1,
      source: 'user',
      content: '请分析这张图',
      attachments: [imageRef],
    },
    {
      type: 'final_answer',
      id: 'parent-answer-1',
      answer_id: 'parent-answer-1',
      timestamp: 2,
      turn_id: 'parent-turn-1',
      conversation_id: 'parent-conversation',
      version: 1,
      content: '父任务回答',
      is_complete: true,
      completion_reason: 'terminal',
    },
  ];
}

describe('child run history attachment policy', () => {
  it('默认继承只保留终态交付，不把工具前播报变成孤立 assistant 历史', () => {
    const history = createParentHistory();
    history.splice(
      1,
      0,
      {
        type: 'final_answer',
        id: 'tool-preamble',
        answer_id: 'tool-preamble',
        timestamp: 2,
        turn_id: 'parent-turn-1',
        conversation_id: 'parent-conversation',
        version: 1,
        content: '我先读取资料。',
        is_complete: true,
        completion_reason: 'tool_call',
      },
      {
        type: 'tool_call_decision',
        id: 'tool-decision',
        timestamp: 3,
        turn_id: 'parent-turn-1',
        conversation_id: 'parent-conversation',
        version: 1,
        tool_name: 'resource_read',
        tool_call_id: ToolCallIdSchema.parse('call-1'),
        phase: 'start',
        status: 'loading',
      }
    );

    const selected = pickChildRunSeedHistory({
      parentHistory: history,
      historyPolicy: { inheritTurns: 1 },
    });

    expect(selected.map(event => event.id)).toEqual(['parent-user-1', 'parent-answer-1']);
  });

  it('只声明继承轮次时保留父文本，但不隐式继承父附件', () => {
    const selected = pickChildRunSeedHistory({
      parentHistory: createParentHistory(),
      historyPolicy: { inheritTurns: 1 },
    });

    expect(selected.map(event => event.id)).toEqual(['parent-user-1', 'parent-answer-1']);
    expect(selected[0]).not.toHaveProperty('attachments');
  });

  it('显式允许附件时保留 durable identity 与原始顺序', () => {
    const selected = pickChildRunSeedHistory({
      parentHistory: createParentHistory(),
      historyPolicy: { inheritTurns: 1, includeAttachments: true },
    });

    expect(selected[0]).toMatchObject({
      id: 'parent-user-1',
      attachments: [imageRef],
    });
  });
});
