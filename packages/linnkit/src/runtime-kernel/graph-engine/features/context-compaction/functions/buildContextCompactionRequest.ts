import type { LlmRequestMessage } from '../../../../../ports';
import { formatSystemReminder } from '../../../../system-reminder/format';

/**
 * 在本 tick 的完整主 Prompt 后追加一条瞬态压缩 Reminder。
 * 原消息 role、结构、内容、附件和顺序逐字不变，既保留精确缓存前缀，
 * 也避免把控制指令降级成最后一个 tool output 内的不可信数据。
 */
export function buildContextCompactionRequest(
  llmMessages: readonly LlmRequestMessage[],
  reminder: string,
): LlmRequestMessage[] {
  const content = formatSystemReminder(reminder);
  return content
    ? [...llmMessages, { role: 'user', content }]
    : [...llmMessages];
}
