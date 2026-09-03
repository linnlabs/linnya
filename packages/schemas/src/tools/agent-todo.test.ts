import { describe, expect, it } from 'vitest';
import { AgentTodoToolResultSchema } from './agent-todo';

describe('AgentTodoToolResultSchema', () => {
  it('区分从未创建的空列表与已有 todo 快照', () => {
    expect(AgentTodoToolResultSchema.parse({
      data: { todo_list_id: null, version: 0, items: [] },
      observation: '当前没有 ToDo（空列表）。',
    }).data.todo_list_id).toBeNull();

    expect(AgentTodoToolResultSchema.parse({
      data: {
        todo_list_id: 'todo_1',
        version: 2,
        items: [{ id: 'item_1', content: '核对合同', status: 'in_progress' }],
      },
      observation: '当前 ToDo 共 1 条。',
    }).data.version).toBe(2);
  });

  it('拒绝半合法条目、重复 ID 和互相矛盾的空快照', () => {
    expect(AgentTodoToolResultSchema.safeParse({
      data: {
        todo_list_id: 'todo_1',
        version: 1,
        items: [
          { id: 'item_1', content: 'A', status: 'pending' },
          { id: 'item_1', content: 'B', status: 'completed' },
        ],
      },
      observation: 'bad',
    }).success).toBe(false);
    expect(AgentTodoToolResultSchema.safeParse({
      data: { todo_list_id: null, version: 1, items: [] },
      observation: 'bad',
    }).success).toBe(false);
    expect(AgentTodoToolResultSchema.safeParse({
      data: {
        todo_list_id: 'todo_1',
        version: 1,
        items: [{ id: '', content: 'A', status: 'pending' }],
      },
      observation: 'bad',
    }).success).toBe(false);
  });
});
