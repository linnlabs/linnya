import type { BaseMessage } from '../types';
import { readToolNameFromConversationMessage } from './toolMessageLookup';

const TODO_TOOL_NAMES = new Set(['todo_read', 'todo_write']);

/**
 * 解析当前会话最新一条 todo 工具消息。
 *
 * 只有消息集合包含真实会话尾部时，才能得出“全会话最新”的结论。timeline
 * 导航到中间窗口时 `hasMoreAfter=true`，此时可见的 todo 都是历史卡片，不能把
 * 窗口内最后一张误判为全会话最新并自动展开。
 */
export function findLatestTodoToolMessageId(
  messages: readonly BaseMessage[],
  includesConversationTail: boolean,
): string | null {
  if (!includesConversationTail) return null;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const toolName = readToolNameFromConversationMessage(message);
    if (toolName && TODO_TOOL_NAMES.has(toolName)) return message.id;
  }

  return null;
}
