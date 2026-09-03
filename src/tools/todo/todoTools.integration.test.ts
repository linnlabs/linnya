import { describe, expect, it } from 'vitest';
import { createToolContextFixture } from '@linnlabs/linnkit/testkit';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { AgentTodoToolResultSchema, AgentTodoWriteResultSchema } from '@app/schemas';

import { TodoReadTool } from './todo_read';
import { TodoWriteTool } from './todo_write';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

function todoWriteOutput(
  id: string,
  result: ReturnType<typeof AgentTodoWriteResultSchema.parse>
): Extract<RuntimeEvent, { type: 'tool_output' }> {
  return {
    type: 'tool_output',
    id,
    conversation_id: 'conversation-todo',
    turn_id: 'turn-todo',
    timestamp: 1,
    version: 1,
    tool_name: 'todo_write',
    tool_call_id: ToolCallIdSchema.parse(`call-${id}`),
    status: 'success',
    observation: result.observation,
    data: result.data,
  };
}

describe('Todo 普通工具历史', () => {
  it('同一 run 内由 working history 继续版本并供 todo_read 读取', async () => {
    const workingHistory: RuntimeEvent[] = [];
    const context = createToolContextFixture({ workingHistoryEvents: workingHistory });
    const first = AgentTodoWriteResultSchema.parse(
      JSON.parse(
        await new TodoWriteTool().run(
          {
            items: [{ content: '核对渲染合同', status: 'in_progress' }],
          },
          context
        )
      )
    );

    workingHistory.push(todoWriteOutput('todo-output-1', first));

    const read = AgentTodoToolResultSchema.parse(
      JSON.parse(await new TodoReadTool().run({}, context))
    );
    expect(read.data).toEqual(first.data);

    const second = AgentTodoWriteResultSchema.parse(
      JSON.parse(
        await new TodoWriteTool().run(
          {
            items: [{ id: first.data.items[0]?.id, content: '核对渲染合同', status: 'completed' }],
          },
          context
        )
      )
    );
    expect(second.data.todo_list_id).toBe(first.data.todo_list_id);
    expect(second.data.version).toBe(2);
  });

  it('新 run 从 persisted working history 恢复，不依赖 Todo 专属 Runtime 状态', async () => {
    const previous = AgentTodoWriteResultSchema.parse({
      data: {
        todo_list_id: 'todo-list-persisted',
        version: 4,
        items: [{ id: 'todo-item-1', content: '继续任务', status: 'pending' }],
      },
      observation: 'ToDo 已更新。',
    });
    const context = createToolContextFixture({
      persistedHistoryEvents: [todoWriteOutput('todo-output-persisted', previous)],
    });

    const next = AgentTodoWriteResultSchema.parse(
      JSON.parse(
        await new TodoWriteTool().run(
          {
            items: [{ id: 'todo-item-1', content: '继续任务', status: 'in_progress' }],
          },
          context
        )
      )
    );
    expect(next.data.todo_list_id).toBe('todo-list-persisted');
    expect(next.data.version).toBe(5);
  });
});
