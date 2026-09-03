/**
 * @file src/tools/todo/todo_read.ts
 *
 * @description
 * 读取当前对话的 Agent ToDo（working memory）快照。
 *
 * 重要约束：
 * - ToDo 是普通工具，不属于 Linnkit Runtime 状态；
 * - 当前快照只来自 working history 中最近一次成功的 todo_write 正式结果；
 * - 本工具不主动注入到每轮 system prompt；需要模型显式调用 todo_read 获取。
 */

import { BaseTool, type ToolContext, type ToolParameterSchema } from '../types';
import { AgentTodoToolResultSchema, type AgentTodoToolResult } from '@app/schemas';
import { readLatestTodoWriteResult } from './functions/readLatestTodoWriteResult';

export class TodoReadTool extends BaseTool {
  readonly name = 'todo_read';

  readonly description = `Reads the current Agent TODO list (working memory) for the active conversation.

# When to Use
- When you need to recall the current plan, progress, or remaining tasks for a long-running task.
- Before updating the TODO list with todo_write to avoid overwriting newer changes.

# Output
Returns the latest TODO snapshot: todo_list_id, version, and items[].`;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {},
    required: []
  };

  /**
   * 给历史压缩器使用的摘要：按条目完整输出（status + content），避免压缩后丢失工作记忆。
   */
  getExecutionSummary(output: string): string {
    const { data } = AgentTodoToolResultSchema.parse(JSON.parse(output));
    if (data.items.length === 0) return '读取 ToDo：空列表。';
    const lines = data.items.map(item => `- [${item.status}] ${item.content}`);
    return `读取 ToDo：${data.items.length} 条：\n${lines.join('\n')}`;
  }

  async run(_args: Record<string, unknown>, context: ToolContext): Promise<string> {
    if (!context.conversationView) {
      throw new Error('todo_read: missing runtime conversationView');
    }
    const snapshot = readLatestTodoWriteResult(
      context.conversationView.getWorkingHistoryEvents(),
    )?.data;
    const data = snapshot ?? {
      todo_list_id: null,
      version: 0,
      items: [],
    } as const;
    const items = data.items;

    const inProgressCount = items.filter((i) => i.status === 'in_progress').length;
    const pendingCount = items.filter((i) => i.status === 'pending').length;
    const completedCount = items.filter((i) => i.status === 'completed').length;
    const cancelledCount = items.filter((i) => i.status === 'cancelled').length;

    const observation =
      items.length === 0
        ? '当前没有 ToDo（空列表）。'
        : `当前 ToDo 共 ${items.length} 条：in_progress=${inProgressCount}，pending=${pendingCount}，completed=${completedCount}，cancelled=${cancelledCount}。`;

    const result: AgentTodoToolResult = {
      data,
      observation
    };

    return JSON.stringify(AgentTodoToolResultSchema.parse(result));
  }
}
