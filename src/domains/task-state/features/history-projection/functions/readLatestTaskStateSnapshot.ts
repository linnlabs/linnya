import { TaskStateWriteResultSchema } from '@app/schemas';
import type { RunId, RuntimeEvent, ToolCallId } from '@linnlabs/linnkit/contracts';

import type { TaskStateHistorySnapshot } from '../definitions/taskStateHistorySnapshot';

function hasMatchingToolCall(
  history: ReadonlyArray<RuntimeEvent>,
  outputIndex: number,
  runId: RunId,
  toolCallId: ToolCallId,
): boolean {
  for (let index = outputIndex - 1; index >= 0; index -= 1) {
    const event = history[index];
    if (
      event.type === 'tool_call_decision'
      && event.run_id === runId
      && event.tool_name === 'task_write'
      && event.tool_call_id === toolCallId
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 从当前 admitted working history 投影最新 TaskState。
 *
 * 只有已配对的成功工具事实有资格进入解析；一旦最新正式事实通过配对但合同损坏，
 * 立即失败，不能跳回旧状态掩盖事件损坏。
 */
export function readLatestTaskStateSnapshot(
  history: ReadonlyArray<RuntimeEvent>,
): TaskStateHistorySnapshot | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const event = history[index];
    if (
      event.type !== 'tool_output'
      || event.status !== 'success'
      || event.tool_name !== 'task_write'
    ) {
      continue;
    }

    // tool_call_id 只在 run 内唯一。未路由的结果或跨 run 的同值调用都不能证明配对关系。
    if (!event.run_id || !hasMatchingToolCall(history, index, event.run_id, event.tool_call_id)) {
      continue;
    }

    const result = {
      data: event.data,
      observation: event.observation,
    };
    const parsed = TaskStateWriteResultSchema.parse(result);
    return {
      taskstate: parsed.data.taskstate,
      version: parsed.data.version,
    };
  }
  return undefined;
}
