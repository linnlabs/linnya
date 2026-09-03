import { describe, expect, it } from 'vitest';

import type { RuntimeEvent } from '../../../contracts';
import { extractFinalAnswer, extractLastProgress } from '../childRunEvents';

function answer(params: {
  id: string;
  content: string;
  reason: 'terminal' | 'tool_call' | 'interrupted';
  timestamp: number;
}): Extract<RuntimeEvent, { type: 'final_answer' }> {
  return {
    type: 'final_answer',
    id: params.id,
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    timestamp: params.timestamp,
    version: 1,
    answer_id: params.id,
    content: params.content,
    completion_reason: params.reason,
    is_complete: params.reason !== 'interrupted',
  };
}

describe('child run settlement', () => {
  it('取消前只有多段工具播报时不伪造 finalAnswer，并单独返回最近进度', () => {
    const events: RuntimeEvent[] = [
      answer({ id: 'preamble-1', content: '我先检查第一页。', reason: 'tool_call', timestamp: 1 }),
      answer({ id: 'preamble-2', content: '继续检查第二页。', reason: 'tool_call', timestamp: 2 }),
      answer({ id: 'partial-3', content: '正在整理剩余问题。', reason: 'interrupted', timestamp: 3 }),
    ];

    expect(extractFinalAnswer(events)).toBeUndefined();
    expect(extractLastProgress(events)).toBe('正在整理剩余问题。');
  });

  it('正常完成时只把 terminal 段作为交付，工具前播报仍可独立观察', () => {
    const events: RuntimeEvent[] = [
      answer({ id: 'preamble', content: '我先读取资料。', reason: 'tool_call', timestamp: 1 }),
      answer({ id: 'terminal', content: '最终交付', reason: 'terminal', timestamp: 2 }),
    ];

    expect(extractFinalAnswer(events)).toBe('最终交付');
    expect(extractLastProgress(events)).toBe('我先读取资料。');
  });
});
