import { TaskStateWriteDataSchema, type TaskState } from '@app/schemas';
import type { BaseMessage, ToolCallMessage } from '../../../types';

/**
 * 本轮最新一次成功的 task_write。只看 task_write：它是模型主动更新计划的事实；task_read 只是读回。
 * 长运行里最新一次写入不在已加载窗口时找不到，托盘就不显示，不去翻更早的轮次。
 */
export function findLatestRunTaskWrite(
  messages: readonly BaseMessage[],
  runId: string,
): ToolCallMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message?.type === 'tool_calls'
      && message.metadata.run_id === runId
      && message.metadata.tool_name === 'task_write'
      && message.metadata.status === 'success'
    ) {
      return message;
    }
  }
  return null;
}

/**
 * 该结果在 admission 时已由 TaskState 工具卡的 presentation projector 用同一合同解析过；
 * 这里再取一次结构化类型，合同不变，所以不会在渲染期失败。
 */
export function readTaskWriteState(message: ToolCallMessage): TaskState {
  return TaskStateWriteDataSchema.parse(message.metadata.data).taskstate;
}
