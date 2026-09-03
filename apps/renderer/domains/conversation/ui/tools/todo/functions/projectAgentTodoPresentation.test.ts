import { describe, expect, it } from 'vitest';
import type { AgentTodoToolResult, AgentTodoWriteResult } from '@app/schemas';
import { projectAgentTodoPresentation } from './projectAgentTodoPresentation';

describe('projectAgentTodoPresentation', () => {
  it('loading 不解析 success result', () => {
    expect(projectAgentTodoPresentation({
      sourceToolName: 'todo_read',
      uiKey: 'todo_read',
      args: {},
      result: undefined,
      status: 'loading',
      phase: 'start',
    })).toMatchObject({
      data: { kind: 'lifecycle', operation: 'read' },
      title: { text: { key: 'conversation.tool.todo.read' } },
    });
  });

  it('read 空快照由 presentation 声明隐藏内容，不让通用 registry 解释 Todo result', () => {
    const result: AgentTodoToolResult = {
      data: { todo_list_id: null, version: 0, items: [] },
      observation: '当前没有 ToDo（空列表）。',
    };
    expect(projectAgentTodoPresentation({
      sourceToolName: 'todo_read',
      uiKey: 'todo_read',
      args: {},
      result,
      status: 'success',
      phase: 'complete',
    })).toMatchObject({
      data: {
        kind: 'snapshot',
        operation: 'read',
        counts: { total: 0 },
        progressPercent: 0,
      },
      title: { text: { key: 'conversation.tool.todo.empty' } },
      hideContent: true,
    });
  });

  it('write success 生成计数与进度，write 不接受 read-only 空快照', () => {
    const result: AgentTodoWriteResult = {
      data: {
        todo_list_id: 'todo-1',
        version: 2,
        items: [
          { id: 'todo-a', content: '实现 projector', status: 'completed' },
          { id: 'todo-b', content: '运行 E2E', status: 'in_progress' },
          { id: 'todo-c', content: '更新文档', status: 'pending' },
        ],
      },
      observation: 'ToDo 已更新。',
    };
    expect(projectAgentTodoPresentation({
      sourceToolName: 'todo_write',
      uiKey: 'todo_write',
      args: {},
      result,
      status: 'success',
      phase: 'complete',
    })).toMatchObject({
      data: {
        kind: 'snapshot',
        operation: 'write',
        counts: { pending: 1, inProgress: 1, completed: 1, total: 3 },
        progressPercent: 33,
      },
      title: {
        text: {
          key: 'conversation.tool.todo.updateCount',
          params: { count: 3 },
        },
      },
    });

    expect(() => projectAgentTodoPresentation({
      sourceToolName: 'todo_write',
      uiKey: 'todo_write',
      args: {},
      result: {
        data: { todo_list_id: null, version: 0, items: [] },
        observation: '当前没有 ToDo。',
      },
      status: 'success',
      phase: 'complete',
    })).toThrow();
  });
});
