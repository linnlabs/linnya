import type { RuntimeEvent, RuntimeEventId } from 'linnkit/contracts';

/**
 * 解析当前 execution 应修订的用户消息。
 *
 * 新请求的 user_input 位于 newEvents；wait-user resume 不会补造新 user_input，因此必须继续使用
 * 已提交历史中的最近一条。该绑定由 Host 在执行开始时确定，Renderer 不按 turn 或消息位置猜测。
 */
export function resolveExecutionUserMessageId(
  history: readonly RuntimeEvent[],
  newEvents: readonly RuntimeEvent[],
): RuntimeEventId | undefined {
  for (let index = newEvents.length - 1; index >= 0; index -= 1) {
    const event = newEvents[index];
    if (event?.type === 'user_input') return event.id;
  }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const event = history[index];
    if (event?.type === 'user_input') return event.id;
  }
  return undefined;
}
