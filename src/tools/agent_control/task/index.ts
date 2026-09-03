/**
 * @file src/tools/agent_control/task/index.ts
 * @description TaskState 工具模块入口
 */

import { TaskWriteTool } from './taskWriteTool';
import { TaskReadTool } from './taskReadTool';

export { TaskWriteTool } from './taskWriteTool';
export { TaskReadTool } from './taskReadTool';
export { readTaskStateWorkingHistory } from './taskStateToolRuntime';
export {
  TASK_STATE_PARAMETER_BUDGET_DESCRIPTION,
  TASK_STATE_PARAMETER_PROPERTIES,
  TASK_STATE_REQUIRED_PARAMETERS,
} from './taskStateToolParameters';
export type { TaskState, TaskPhase } from '../../../domains/task-state';
export { parseTaskState } from '../../../domains/task-state';

export const taskStateToolClasses = [TaskWriteTool, TaskReadTool] as const;
