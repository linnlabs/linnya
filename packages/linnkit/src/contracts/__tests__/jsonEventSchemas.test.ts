import { describe, expect, it } from 'vitest';

import {
  RuntimeEvent,
  SSEToolOutputEvent,
  createFinalAnswerEvent,
  createToolOutputEvent,
} from '../index';

function baseRuntimeEvent() {
  return {
    id: 'evt-1',
    conversation_id: 'conv-1',
    turn_id: 'turn-1',
    timestamp: 1,
    version: 1,
  };
}

describe('RuntimeEvent / SSE JSON-safe payload contracts', () => {
  it('由 final_answer 封口原因唯一决定完成性，并拒绝缺失原因的事实', () => {
    const terminal = createFinalAnswerEvent(
      'answer-terminal',
      'conv-1',
      'turn-1',
      '最终交付',
      { completion_reason: 'terminal' },
    );
    const interrupted = createFinalAnswerEvent(
      'answer-interrupted',
      'conv-1',
      'turn-1',
      '处理中',
      { completion_reason: 'interrupted' },
    );

    expect(terminal.is_complete).toBe(true);
    expect(terminal.id).toBe(terminal.answer_id);
    expect(interrupted.is_complete).toBe(false);
    expect(interrupted.id).toBe(interrupted.answer_id);
    expect(RuntimeEvent.safeParse({ ...terminal, is_complete: false }).success).toBe(false);
    expect(RuntimeEvent.safeParse({ ...terminal, id: 'different-event-id' }).success).toBe(false);
    expect(RuntimeEvent.safeParse({
      ...baseRuntimeEvent(),
      type: 'final_answer',
      answer_id: 'answer-missing-reason',
      content: '缺少封口原因',
      is_complete: true,
    }).success).toBe(false);
  });

  it('rejects non-serializable RuntimeEvent payloads', () => {
    const parsed = RuntimeEvent.safeParse({
      ...baseRuntimeEvent(),
      type: 'tool_output',
      tool_name: 'lookup',
      tool_call_id: 'call-1',
      status: 'success',
      observation: 'lookup complete',
      data: () => 'not-json',
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects non-serializable SSE payloads', () => {
    const parsed = SSEToolOutputEvent.safeParse({
      ...baseRuntimeEvent(),
      type: 'tool_output',
      tool_name: 'lookup',
      tool_call_id: 'call-1',
      status: 'success',
      observation: 'lookup complete',
      data: Symbol('not-json'),
    });

    expect(parsed.success).toBe(false);
  });

  it('normalizes helper output to JSON-safe values at the boundary', () => {
    const event = createToolOutputEvent(
      'evt-1',
      'conv-1',
      'turn-1',
      'lookup',
      'call-1',
      {
        status: 'success',
        observation: 'done',
        data: { ok: true, dropped: () => 'not-json' },
      },
    );

    expect(RuntimeEvent.parse(event)).toMatchObject({
      type: 'tool_output',
      observation: 'done',
      data: { ok: true },
    });
  });
});
