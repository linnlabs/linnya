/**
 * @file src/tools/agent_control/task/taskWriteTool.ts
 * @description 写入/更新 TaskState（结构化任务状态白板）
 *
 * 设计要点：
 * - 接受结构化参数 → 交给 TaskState domain 保存对话作用域快照
 * - 整表快照覆盖（与 todo_write 一致），不做增量 patch
 * - 写入后工具对留在上下文，AI 下一轮直接可见——不需要热注入
 * - 状态由 admitted working history 中的配对工具事实投影，不建立另一份状态存储
 */

import { BaseTool, type ToolContext, type ToolParameterSchema } from '../../types';
import {
  TaskStateWriteResultSchema,
  type TaskStateWriteResult,
} from '@app/schemas';
import {
  createNextTaskStateSnapshot,
  formatTaskStateObservation,
  parseTaskState,
} from '../../../domains/task-state';
import { readTaskStateWorkingHistory } from './taskStateToolRuntime';
import {
  TASK_STATE_PARAMETER_BUDGET_DESCRIPTION,
  TASK_STATE_TOOL_PARAMETER_SCHEMA,
} from './taskStateToolParameters';

export class TaskWriteTool extends BaseTool {
  readonly name = 'task_write';

  readonly description = `Update the structured TaskState snapshot for the current long-running task.

# When to Use
- At the start of a complex task: create an initial TaskState with goal, plan, and first steps.
- During execution: update progress, adjust plan, or change phase.
- At meaningful phase boundaries: preserve the facts and next steps needed to continue.

# Important
- This overwrites the entire TaskState (snapshot semantics).
- For simple tasks, do NOT create a TaskState — it adds unnecessary overhead.
- The tool output stays in your context, so you can always see the latest TaskState.
- ${TASK_STATE_PARAMETER_BUDGET_DESCRIPTION}`;

  readonly parameters: ToolParameterSchema = TASK_STATE_TOOL_PARAMETER_SCHEMA;

  /**
   * 给历史压缩器使用的摘要
   * TaskState 自身就是精炼的状态快照，保留完整内容避免压缩后丢失关键信息。
   */
  getExecutionSummary(output: string): string {
    const parsed: unknown = JSON.parse(output);
    const result = TaskStateWriteResultSchema.parse(parsed);
    const taskstate = result.data.taskstate;
    const lines = [
      `TaskState 已更新 (v${result.data.version}):`,
      `  Goal: ${taskstate.goal}`,
      `  Phase: ${taskstate.current_phase}`,
      `  Plan: ${taskstate.current_plan.join(' → ')}`,
      `  Progress: ${taskstate.progress}`,
      `  Next: ${taskstate.next_steps.join('; ')}`,
      `  Refs: ${taskstate.references.join(', ')}`,
    ];
    return lines.join('\n');
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const validation = this.validateArguments(args);
    if (!validation.success) {
      throw new Error(validation.error ?? 'task_write: invalid arguments');
    }

    const taskstate = parseTaskState(args);
    const snapshot = createNextTaskStateSnapshot({
      history: readTaskStateWorkingHistory(context, '[task_write]'),
      taskstate,
    });
    const observation = formatTaskStateObservation(taskstate, snapshot.version);

    const result: TaskStateWriteResult = {
      data: {
        operation: snapshot.operation,
        version: snapshot.version,
        taskstate,
      },
      observation,
    };

    return JSON.stringify(TaskStateWriteResultSchema.parse(result));
  }
}
