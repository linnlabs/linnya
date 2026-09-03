import type { BaseMessage } from '../types';
import { isBlankFinalAnswerMessage } from './renderableConversationMessage';

export function resolveTurnFinalAnswers(
  messages: readonly BaseMessage[],
): BaseMessage[] {
  return messages.filter(message => (
    message.type === 'final_answer' && !isBlankFinalAnswerMessage(message)
  ));
}

/**
 * 操作行只归属于当前 turn 最后一条有效最终回答，不能聚合更早的回答块。
 * 这样 visual-row 中按钮与被复制的真实 DOM 始终共存于同一行。
 */
export function resolveTerminalFinalAnswer(
  messages: readonly BaseMessage[],
): BaseMessage | null {
  const answers = resolveTurnFinalAnswers(messages);
  return answers[answers.length - 1] ?? null;
}
