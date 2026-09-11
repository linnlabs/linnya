/**
 * @file src/tools/todo/todo_write.ts
 *
 * @description
 * 写入/更新当前对话的 Agent ToDo（working memory）。
 *
 * 设计约束（根因级）：
 * - 写入语义为“整表快照”（replace），避免并发合并语义不清；
 * - Todo 是普通工具，状态仅由最近一次成功的 todo_write 结构化结果表达；
 * - 同一 run 与跨 run 都通过 Linnkit 的通用 working history 读取，禁止增加工具专属 Runtime 状态。
 */

import { BaseTool, type ToolContext, type ToolParameterSchema } from '../types';
import {
  AgentTodoToolItemSchema,
  AgentTodoToolStatusSchema,
  AgentTodoWriteResultSchema,
  type AgentTodoToolItem,
  type AgentTodoWriteResult,
} from '@app/schemas';
import { z } from 'zod';

import { generateMessageId } from '../../shared/utils/idUtils';
import { readLatestTodoWriteResult } from './functions/readLatestTodoWriteResult';

const TodoWriteArgsSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1).refine(value => value === value.trim()).optional(),
    content: z.string().trim().min(1),
    status: AgentTodoToolStatusSchema,
  }).strict()),
}).strict();
type TodoWriteArgs = z.infer<typeof TodoWriteArgsSchema>;

function normalizeItems(raw: TodoWriteArgs['items']): AgentTodoToolItem[] {
  return raw.map(it => {
    const item = {
      id: it.id ?? `todo_item_${generateMessageId()}`,
      content: it.content,
      status: it.status,
    };
    return AgentTodoToolItemSchema.parse(item);
  });
}

export class TodoWriteTool extends BaseTool {
  readonly name = 'todo_write';
  // 每次调用表达新的整表快照意图；A→B→A 必须产生第三版，不能按历史同参结果去重。

  readonly description = `Writes the Agent TODO list (working memory) for the active conversation.

Important:
- This tool overwrites the entire TODO list (snapshot semantics).
- After writing, always call todo_read if you need to confirm the latest version.

# When to Use
- When you need to create or update a structured plan for a long-running task.
- When you need to reflect progress (pending/in_progress/completed/cancelled).

# Output
Returns the updated TODO snapshot: todo_list_id, version, and items[].`;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: '完整 ToDo 列表（整表覆盖）。每个条目包含 id(可选)/content/status。',
        items: {
          type: 'object',
          description: '单条 ToDo（最小字段：content + status；可选 id）。',
          properties: {
            id: { type: 'string', description: '条目ID（可选；缺省时由工具生成）' },
            content: { type: 'string', description: '条目内容（必填）' },
            status: {
              type: 'string',
              description: "条目状态（必填）",
              enum: ['pending', 'in_progress', 'completed', 'cancelled']
            }
          },
          required: ['content', 'status']
        }
      }
    },
    required: ['items']
  };

  /**
   * 给历史压缩器使用的摘要（ToolHistoryCompressor 会用它替换冗长的 tool_output）。
   *
   * 这里按你们的产品取舍：ToDo 本身短、但对“继续任务/对齐进度”非常关键，
   * 因此 summary 保留**全部条目**（而不是只保留数量），避免压缩后丢失工作记忆。
   */
  getExecutionSummary(output: string): string {
    const { data } = AgentTodoWriteResultSchema.parse(JSON.parse(output));
    const lines = data.items.map(item => `- [${item.status}] ${item.content}`);
    return lines.length === 0
      ? 'ToDo 已更新（0 条）。'
      : `ToDo 已更新（${data.items.length} 条）：\n${lines.join('\n')}`;
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const validation = this.validateArguments(args);
    if (!validation.success) {
      throw new Error(validation.error ?? 'todo_write: invalid arguments');
    }

    const parsedArgs = TodoWriteArgsSchema.parse(args);
    const normalizedItems = normalizeItems(parsedArgs.items);

    if (!context.conversationView) {
      throw new Error('todo_write: missing runtime conversationView');
    }
    const previous = readLatestTodoWriteResult(
      context.conversationView.getWorkingHistoryEvents(),
    )?.data;
    const todoListId = previous?.todo_list_id ?? `todo_${generateMessageId()}`;
    const nextVersion = (previous?.version ?? 0) + 1;

    const inProgressCount = normalizedItems.filter((i) => i.status === 'in_progress').length;
    const pendingCount = normalizedItems.filter((i) => i.status === 'pending').length;
    const completedCount = normalizedItems.filter((i) => i.status === 'completed').length;
    const cancelledCount = normalizedItems.filter((i) => i.status === 'cancelled').length;

    const observation = `ToDo 已更新：共 ${normalizedItems.length} 条（in_progress=${inProgressCount}，pending=${pendingCount}，completed=${completedCount}，cancelled=${cancelledCount}）。`;

    const result: AgentTodoWriteResult = {
      data: {
        todo_list_id: todoListId,
        version: nextVersion,
        items: normalizedItems
      },
      observation
    };

    return JSON.stringify(AgentTodoWriteResultSchema.parse(result));
  }
}
