import { describe, expect, it } from 'vitest';
import type { AssistantMessage, BaseMessage } from '../types';
import {
  createTestAnswerMessage,
  createTestThoughtMessage,
  createTestToolMessage,
} from '../testing/functions/createConversationTestMessage';
import { resolveTerminalFinalAnswer, resolveTurnFinalAnswers } from './resolveTerminalFinalAnswer';

function message(id: string, type: AssistantMessage['type'], content: string): BaseMessage {
  switch (type) {
    case 'thought':
      return createTestThoughtMessage({ id, content, timestamp: 1 });
    case 'tool_calls':
      return createTestToolMessage({ id, content, timestamp: 1 });
    case 'final_answer':
    case 'tool_preamble':
    case 'partial_answer':
      return createTestAnswerMessage({ id, type, content, timestamp: 1 });
  }
}

describe('resolveTerminalFinalAnswer', () => {
  it('returns every non-empty final answer in message order for turn transfer', () => {
    const result = resolveTurnFinalAnswers([
      message('answer-old', 'final_answer', 'old answer'),
      message('thought', 'thought', 'later thought'),
      message('answer-empty', 'final_answer', '  '),
      message('answer-current', 'final_answer', 'current answer'),
    ]);

    expect(result.map(answer => answer.id)).toEqual(['answer-old', 'answer-current']);
  });

  it('returns only the last non-empty final answer in a turn', () => {
    const result = resolveTerminalFinalAnswer([
      message('answer-old', 'final_answer', 'old answer'),
      message('thought', 'thought', 'later thought'),
      message('answer-empty', 'final_answer', '  '),
      message('answer-current', 'final_answer', 'current answer'),
      message('tool', 'tool_calls', ''),
    ]);

    expect(result?.id).toBe('answer-current');
  });

  it('returns null when the turn has no usable final answer', () => {
    expect(resolveTerminalFinalAnswer([
      message('thought', 'thought', 'working'),
      message('answer-empty', 'final_answer', ''),
    ])).toBeNull();
  });
});
