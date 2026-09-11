import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToolContextFixture } from '@linnlabs/linnkit/testkit';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { AgentTodoToolResultSchema, AgentTodoWriteResultSchema } from '@app/schemas';

import { TodoReadTool } from './todo_read';
import { TodoWriteTool } from './todo_write';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { ToolRegistry } from '../../app-hosts/linnya/adapters/tools/toolRegistry';
import * as builtin from '../../app-hosts/linnya/plugin-registry/builtin';

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
  afterEach(() => vi.restoreAllMocks());

  it('正式工具入口 A → B → A 时写出第三版，不复用第一版历史结果', async () => {
    vi.spyOn(builtin, 'getRegisteredToolClasses').mockReturnValue([TodoWriteTool, TodoReadTool]);
    vi.spyOn(builtin, 'getRegisteredToolContextDecorators').mockReturnValue([]);
    const registry = new ToolRegistry({ strictInitialization: true });
    const history: RuntimeEvent[] = [];
    const context = createToolContextFixture({
      conversationId: 'conversation-todo', turnId: 'turn-todo', workingHistoryEvents: history,
    });
    const versions: number[] = [];
    for (const status of ['pending', 'completed', 'pending'] as const) {
      const output = await registry.executeTool('todo_write', {
        items: [{ id: 'item-a', content: '核对任务', status }],
      }, context);
      if (!output.success || typeof output.result !== 'string') throw new Error('TODO 写入失败');
      const result = AgentTodoWriteResultSchema.parse(JSON.parse(output.result));
      versions.push(result.data.version);
      history.push({
        ...todoWriteOutput(`todo-${history.length}`, result),
        ...(output.idempotency ? { metadata: { idempotency: output.idempotency } } : {}),
      });
    }
    const latest = AgentTodoToolResultSchema.parse(JSON.parse(await new TodoReadTool().run({}, context)));
    expect(versions).toEqual([1, 2, 3]);
    expect(latest.data).toMatchObject({ version: 3, items: [{ status: 'pending' }] });
  });
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
