/**
 * @file src/tools/agent_control/task/taskReadTool.ts
 * @description 读取当前 TaskState 快照
 *
 * 用途：
 * - 主 Agent 在上下文被裁剪后恢复当前 Conversation 状态
 * - 大多数情况下父 Agent 不需要调用（TaskState 工具对就在上下文里）
 */

import { BaseTool, type ToolContext, type ToolParameterSchema } from '../../types';
import {
  TaskStateReadResultSchema,
  type TaskStateReadResult,
} from '@app/schemas';
import { readLatestTaskStateSnapshot } from '../../../domains/task-state';
import { readTaskStateWorkingHistory } from './taskStateToolRuntime';

export class TaskReadTool extends BaseTool {
  readonly name = 'task_read';

  readonly description = `Read the current TaskState snapshot for the active conversation.

# When to Use
- After automatic context compaction: if you can't see the latest task_write in your context.
- In most cases you do NOT need to call this — the latest task_write tool output is already in your context.

# Output
Returns the current structured TaskState and its version number.`;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {},
    required: [],
  };

  getExecutionSummary(output: string): string {
    const parsed: unknown = JSON.parse(output);
    const result = TaskStateReadResultSchema.parse(parsed);
    if (!result.data.exists) {
      return result.observation;
    }
    const state = result.data.taskstate;
    return [
      `读取 TaskState (v${result.data.version}):`,
      `  Goal: ${state.goal}`,
      `  Phase: ${state.current_phase}`,
      `  Plan: ${state.current_plan.join(' → ')}`,
      `  Progress: ${state.progress}`,
      `  Next: ${state.next_steps.join('; ')}`,
      `  Refs: ${state.references.join(', ')}`,
    ].join('\n');
  }

  async run(_args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const snapshot = readLatestTaskStateSnapshot(
      readTaskStateWorkingHistory(context, '[task_read]'),
    );
    if (!snapshot) {
      const result: TaskStateReadResult = {
        data: {
          exists: false,
        },
        observation: 'TaskState 不存在。请在需要时使用 task_write 创建。',
      };
      return JSON.stringify(TaskStateReadResultSchema.parse(result));
    }

    const result: TaskStateReadResult = {
      data: {
        exists: true,
        version: snapshot.version,
        taskstate: snapshot.taskstate,
      },
      observation: `TaskState (v${snapshot.version}) 已读取。`,
    };

    return JSON.stringify(TaskStateReadResultSchema.parse(result));
  }
}
