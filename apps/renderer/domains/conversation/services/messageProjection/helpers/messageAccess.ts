import type { BaseMessage } from '../../../types';
import { cloneConversationMessage } from '../../../functions/cloneConversationMessage';
import type { MessageProjectionState, ProjectedMessage } from '../state';

/**
 * @description
 * MessageProjection 的基础"消息存取"助手函数。
 *
 * 原则：
 * - 纯函数风格：只修改传入的 state，不触发外部副作用；
 * - 集中管理：避免在多个 projector 内散落同类逻辑，降低重复。
 */

export function buildMessageIndex(messages: readonly ProjectedMessage[]): Map<string, number> {
  const index = new Map<string, number>();
  messages.forEach((message, messageIndex) => {
    if (index.has(message.id)) {
      throw new Error(
        `Duplicate conversation message id during projection initialization: ${message.id}`,
      );
    }
    index.set(message.id, messageIndex);
  });
  return index;
}

export function appendMessage(state: MessageProjectionState, message: ProjectedMessage): void {
  if (state.messageIndex.has(message.id)) {
    throw new Error(`Duplicate conversation message id during projection append: ${message.id}`);
  }
  const messageIndex = state.conversation.messages.length;
  state.conversation.messages.push(message);
  state.messageIndex.set(message.id, messageIndex);
  state.conversation.updatedAt = Date.now();
}

export function getMessageById(
  state: MessageProjectionState,
  messageId: string | null | undefined
): ProjectedMessage | null {
  if (!messageId) return null;
  const messageIndex = state.messageIndex.get(messageId);
  if (messageIndex === undefined) return null;
  const message = state.conversation.messages[messageIndex];
  return message ?? null;
}

export function getMessageIndexById(state: MessageProjectionState, messageId: string): number | null {
  const messageIndex = state.messageIndex.get(messageId);
  return messageIndex === undefined ? null : messageIndex;
}

export function updateMessage(
  state: MessageProjectionState,
  messageId: string,
  updater: (message: BaseMessage) => void
): boolean {
  const messageIndex = state.messageIndex.get(messageId);
  if (messageIndex === undefined) return false;

  const current = state.conversation.messages[messageIndex];
  if (!current) return false;

  /**
   * 关键：
   * - projector 过去会原地修改同一个 message 对象；
   * - 这会让 append-only turn/cache 很难感知“消息已更新但 id 没变”的场景，
   *   尤其是 subrun_trace 只改 metadata.subrunTraceVersion 时，UI 会误判为“最后一轮未变化”。
   *
   * 这里改为“替换消息对象”：
   * - 顶层 message 始终生成新引用；
   * - metadata 做一次浅拷贝，确保常见 metadata patch 能被上层视图缓存感知；
   * - 不做深拷贝，避免高频事件下引入额外大对象复制。
   */
  const nextMessage = cloneConversationMessage(current);

  updater(nextMessage);
  state.conversation.messages[messageIndex] = nextMessage;
  state.conversation.updatedAt = Date.now();
  return true;
}

export function replaceMessageById(
  state: MessageProjectionState,
  messageId: string,
  nextMessage: ProjectedMessage
): boolean {
  const messageIndex = state.messageIndex.get(messageId);
  if (messageIndex === undefined) return false;

  state.conversation.messages[messageIndex] = nextMessage;
  if (nextMessage.id !== messageId) {
    state.messageIndex.delete(messageId);
    state.messageIndex.set(nextMessage.id, messageIndex);
  }
  state.conversation.updatedAt = Date.now();
  return true;
}

function reindexMessagesFrom(state: MessageProjectionState, startIndex: number): void {
  for (let i = startIndex; i < state.conversation.messages.length; i += 1) {
    const message = state.conversation.messages[i];
    if (message) {
      state.messageIndex.set(message.id, i);
    }
  }
}

export function removeMessageById(state: MessageProjectionState, messageId: string): boolean {
  const messageIndex = state.messageIndex.get(messageId);
  if (messageIndex === undefined) {
    return false;
  }

  state.conversation.messages.splice(messageIndex, 1);
  state.messageIndex.delete(messageId);
  reindexMessagesFrom(state, messageIndex);
  state.conversation.updatedAt = Date.now();
  return true;
}
