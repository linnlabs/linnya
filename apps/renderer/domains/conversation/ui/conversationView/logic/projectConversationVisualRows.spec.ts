import { describe, expect, it } from 'vitest';
import type { BaseMessage } from '../../../types';
import {
  createTestAnswerMessage,
  createTestThoughtMessage,
  createTestUserMessage,
} from '../../../testing/functions/createConversationTestMessage';
import { projectConversationVisualRows } from './projectConversationVisualRows';

function message(
  id: string,
  role: BaseMessage['role'],
  type: BaseMessage['type'],
  content: string,
  metadata?: {
    readonly turn_id?: string;
    readonly ui?: { readonly presentation: 'message' | 'hidden' };
  },
): BaseMessage {
  if (type === 'user_input') return createTestUserMessage({ id, content, metadata });
  if (type === 'thought') return createTestThoughtMessage({ id, content, metadata });
  return createTestAnswerMessage({ id, content, metadata });
}

describe('projectConversationVisualRows', () => {
  it('projects one row per visible message and preserves turn boundaries', () => {
    const rows = projectConversationVisualRows([
      message('u1', 'user', 'user_input', 'first question'),
      message('t1', 'assistant', 'thought', 'thinking'),
      message('a1', 'assistant', 'final_answer', 'first answer'),
      message('u2', 'user', 'user_input', 'second question'),
    ]);

    expect(rows.map(row => ({
      key: row.key,
      visualTurnId: row.visualTurnId,
      start: row.isTurnStart,
      end: row.isTurnEnd,
    }))).toEqual([
      { key: 'msg_u1', visualTurnId: 'visual_turn_u1', start: true, end: false },
      { key: 'msg_t1', visualTurnId: 'visual_turn_u1', start: false, end: false },
      { key: 'msg_a1', visualTurnId: 'visual_turn_u1', start: false, end: true },
      { key: 'msg_u2', visualTurnId: 'visual_turn_u2', start: true, end: true },
    ]);
    expect(rows[0]?.turnContext).toBe(rows[2]?.turnContext);
    expect(rows[0]?.turnContext.sourceMessageIds).toEqual(['u1', 't1', 'a1']);
  });

  it('keeps partial history turns addressable when user_input is outside the window', () => {
    const rows = projectConversationVisualRows([
      message('t9', 'assistant', 'thought', 'partial thought', { turn_id: 'runtime-turn-9' }),
      message('a9', 'assistant', 'final_answer', 'partial answer', { turn_id: 'runtime-turn-9' }),
      message('u10', 'user', 'user_input', 'next question'),
    ]);

    expect(rows[0]).toMatchObject({
      key: 'msg_t9',
      visualTurnId: 'visual_turn_partial_t9',
      isTurnStart: true,
      isTurnEnd: false,
    });
    expect(rows[1]).toMatchObject({ isTurnEnd: true });
    expect(rows[0]?.turnContext.userMessageId).toBeNull();
    expect(rows[2]).toMatchObject({
      visualTurnId: 'visual_turn_u10',
      isTurnStart: true,
      isTurnEnd: true,
    });
    expect(rows.map(row => row.visualTurnId)).not.toContain('runtime-turn-9');
  });

  it('hidden user input 不拥有可见 turn，后续答案仍归属前一个可见 turn', () => {
    const rows = projectConversationVisualRows([
      message('u1', 'user', 'user_input', 'run'),
      message('hidden', 'user', 'user_input', 'internal', { ui: { presentation: 'hidden' } }),
      message('a1', 'assistant', 'final_answer', 'done'),
    ]);

    expect(rows.map(row => row.key)).toEqual(['msg_u1', 'msg_a1']);
    expect(rows[1]?.visualTurnId).toBe('visual_turn_u1');
    expect(rows[1]?.turnContext.sourceMessageIds).toEqual(['u1', 'a1']);
  });

  it('long table answers remain natural-height', () => {
    const tableRows = Array.from({ length: 40 }, (_, index) => `| ${index} | value ${index} |`).join('\n');
    const rows = projectConversationVisualRows([
      message('u1', 'user', 'user_input', 'run and compare'),
      message('a1', 'assistant', 'final_answer', `| index | value |\n| --- | --- |\n${tableRows}`),
    ], { widthPx: 420 });

    expect(rows.map(row => ({ key: row.key, bounded: row.bounded }))).toEqual([
      { key: 'msg_u1', bounded: false },
      { key: 'msg_a1', bounded: false },
    ]);
  });
});
