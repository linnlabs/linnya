import type { AnswerMessage, BaseMessage } from '../../types';
import type {
  WindowLiveMessageConflict,
  WindowMessageRow,
} from '../definitions/messageWindow';

function isAnswerMessage(message: BaseMessage): message is AnswerMessage {
  return message.type === 'final_answer'
    || message.type === 'tool_preamble'
    || message.type === 'partial_answer';
}

function areWindowAndLiveMessageTypesCompatible(
  windowMessage: BaseMessage,
  liveMessage: BaseMessage,
): boolean {
  return windowMessage.type === liveMessage.type
    || (isAnswerMessage(windowMessage) && isAnswerMessage(liveMessage));
}

/**
 * 两侧消息都已通过各自的 strict schema admission；这里仅判断跨来源相遇后才可见的冲突。
 * completion_reason 是答案 attempt 是否封口的正式事实，禁止用 timestamp 或 sort_seq 猜新旧。
 */
export function findWindowLiveMessageConflictForPair(
  windowMessage: BaseMessage,
  liveMessage: BaseMessage,
): WindowLiveMessageConflict | null {
  if (!areWindowAndLiveMessageTypesCompatible(windowMessage, liveMessage)) {
    return {
      kind: 'message_type',
      messageId: liveMessage.id,
      windowType: windowMessage.type,
      liveType: liveMessage.type,
    };
  }

  if (!isAnswerMessage(windowMessage) || !isAnswerMessage(liveMessage)) return null;
  const windowCompletionReason = windowMessage.metadata.completion_reason;
  const liveCompletionReason = liveMessage.metadata.completion_reason;
  if (windowCompletionReason === undefined || liveCompletionReason === undefined) return null;

  const contentMismatch = windowMessage.content !== liveMessage.content;
  if (windowCompletionReason === liveCompletionReason && !contentMismatch) return null;
  return {
    kind: 'answer_seal',
    messageId: liveMessage.id,
    windowType: windowMessage.type,
    liveType: liveMessage.type,
    windowCompletionReason,
    liveCompletionReason,
    contentMismatch,
  };
}

/**
 * window 与 live 各自已完成单边 schema admission；这里校验只有两侧相遇时才可见的
 * 跨来源合同：非答案类型不得复用 message_id；答案除共享 answer_id 外，还必须代表同一
 * seal 事实。具体优先级由答案合成规则负责。
 */
export function findWindowLiveMessageConflict(
  windowRows: readonly WindowMessageRow[],
  liveMessages: readonly BaseMessage[],
): WindowLiveMessageConflict | null {
  const windowMessagesById = new Map<string, BaseMessage>();
  for (const row of windowRows) {
    windowMessagesById.set(row.message.id, row.message);
  }

  for (const liveMessage of liveMessages) {
    const windowMessage = windowMessagesById.get(liveMessage.id);
    if (!windowMessage) continue;
    const conflict = findWindowLiveMessageConflictForPair(windowMessage, liveMessage);
    if (conflict) return conflict;
  }
  return null;
}

export function formatWindowLiveMessageConflict(
  conflict: WindowLiveMessageConflict,
): string {
  if (conflict.kind === 'message_type') {
    return `Conversation message ${conflict.messageId} changed type across window/live sources: ${conflict.windowType} -> ${conflict.liveType}`;
  }
  return `Conversation answer ${conflict.messageId} has conflicting sealed facts across window/live sources: completion_reason=${conflict.windowCompletionReason} -> ${conflict.liveCompletionReason}, content=${conflict.contentMismatch ? 'different' : 'same'}`;
}

/** 仅供 window/live 写入边界调用；禁止从 computed、watch 或 render effect 调用。 */
export function admitWindowAndLiveMessages(
  windowRows: readonly WindowMessageRow[],
  liveMessages: readonly BaseMessage[],
): void {
  const conflict = findWindowLiveMessageConflict(windowRows, liveMessages);
  if (conflict) {
    throw new Error(formatWindowLiveMessageConflict(conflict));
  }
}
