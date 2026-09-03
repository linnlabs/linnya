import {
  AgentTodoWriteResultSchema,
  type AgentTodoWriteResult,
} from '@app/schemas';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';

/**
 * 从通用工具事实中读取最近一次成功的 todo_write。
 *
 * Todo 不是 Runtime 状态：Linnkit 只提供 working history，具体工具自己
 * 识别自己的 tool_output 并严格校验 canonical data。命中的最新事实损坏时
 * 直接失败，禁止跳过坏事实或改从 metadata 猜测另一份状态。
 */
export function readLatestTodoWriteResult(
  history: ReadonlyArray<RuntimeEvent>,
): AgentTodoWriteResult | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const event = history[index];
    if (
      event.type !== 'tool_output'
      || event.tool_name !== 'todo_write'
      || event.status !== 'success'
    ) {
      continue;
    }
    return AgentTodoWriteResultSchema.parse({
      data: event.data,
      observation: event.observation,
    });
  }
  return undefined;
}
