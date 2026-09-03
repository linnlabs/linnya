import { describe, expect, it } from 'vitest';
import type { BaseMessage } from '../types';
import { findLatestTodoToolMessageId } from './latestTodoToolMessage';
import { createTestToolMessage } from '../testing/functions/createConversationTestMessage';

function createToolMessage(id: string, toolName: string): BaseMessage {
  return createTestToolMessage({
    id,
    metadata: { tool_call_id: `call-${id}`, tool_name: toolName },
  });
}

describe('findLatestTodoToolMessageId', () => {
  it('returns the newest todo tool when the message set includes the conversation tail', () => {
    const messages = [
      createToolMessage('todo-old', 'todo_write'),
      createToolMessage('search', 'web_search'),
      createToolMessage('todo-latest', 'todo_read'),
    ];

    expect(findLatestTodoToolMessageId(messages, true)).toBe('todo-latest');
  });

  it('does not claim a visible todo is globally latest for a middle history window', () => {
    const messages = [createToolMessage('visible-history-todo', 'todo_write')];

    expect(findLatestTodoToolMessageId(messages, false)).toBeNull();
  });
});
