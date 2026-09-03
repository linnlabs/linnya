import { describe, expect, it } from 'vitest';
import type { RuntimeEvent, SerializableJsonValue } from '@linnlabs/linnkit/contracts';
import { createToolOutputEvent } from '@linnlabs/linnkit/contracts';

import { readLatestTodoWriteResult } from './readLatestTodoWriteResult';

function isRecord(value: unknown): value is Record<string, SerializableJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toolOutput(input: {
  id: string;
  toolName: string;
  status?: 'success' | 'error';
  result: SerializableJsonValue;
}): Extract<RuntimeEvent, { type: 'tool_output' }> {
  if (input.status === 'error') {
    return createToolOutputEvent(
      input.id,
      'conversation-1',
      'turn-1',
      input.toolName,
      `call-${input.id}`,
      { status: 'error', observation: 'todo fixture', error: 'todo write failed' },
      { timestamp: 1 }
    );
  }
  const result = isRecord(input.result) ? input.result : {};
  return createToolOutputEvent(
    input.id,
    'conversation-1',
    'turn-1',
    input.toolName,
    `call-${input.id}`,
    {
      status: 'success',
      observation: typeof result.observation === 'string' ? result.observation : 'todo fixture',
      data: result.data ?? null,
    },
    { timestamp: 1 }
  );
}

describe('readLatestTodoWriteResult', () => {
  it('只读取最近一条成功 todo_write 的正式 result', () => {
    const oldResult = {
      data: {
        todo_list_id: 'todo-list-1',
        version: 1,
        items: [{ id: 'item-1', content: '旧任务', status: 'completed' }],
      },
      observation: '旧状态',
    };
    const latestResult = {
      data: {
        todo_list_id: 'todo-list-1',
        version: 2,
        items: [{ id: 'item-2', content: '新任务', status: 'in_progress' }],
      },
      observation: '新状态',
    };
    const history: RuntimeEvent[] = [
      toolOutput({ id: 'old', toolName: 'todo_write', result: oldResult }),
      toolOutput({ id: 'other', toolName: 'resource_read', result: latestResult }),
      toolOutput({ id: 'failed', toolName: 'todo_write', status: 'error', result: latestResult }),
      toolOutput({ id: 'latest', toolName: 'todo_write', result: latestResult }),
    ];

    expect(readLatestTodoWriteResult(history)).toEqual(latestResult);
  });

  it('命中的最新 todo_write result 损坏时明确失败，不回退旧快照', () => {
    const validResult = {
      data: {
        todo_list_id: 'todo-list-1',
        version: 1,
        items: [{ id: 'item-1', content: '旧任务', status: 'pending' }],
      },
      observation: '旧状态',
    };
    const history: RuntimeEvent[] = [
      toolOutput({ id: 'old', toolName: 'todo_write', result: validResult }),
      toolOutput({ id: 'broken', toolName: 'todo_write', result: { data: { items: [] } } }),
    ];

    expect(() => readLatestTodoWriteResult(history)).toThrow();
  });
});
