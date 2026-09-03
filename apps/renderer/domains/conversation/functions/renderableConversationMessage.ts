import type { BaseMessage } from '../types';
import { isBlankAnswerContent } from './answerContent';

function readUiPresentation(message: BaseMessage): 'message' | 'hidden' | undefined {
  switch (message.type) {
    case 'user_input':
      return message.metadata?.ui?.presentation;
    case 'thought':
    case 'final_answer':
    case 'tool_preamble':
    case 'partial_answer':
    case 'history_summary':
      return message.metadata.ui?.presentation;
    case 'tool_calls':
    case 'summarization_progress':
      return undefined;
  }
}

/** 空白 final_answer：内容仅由不可见字符构成，不应占用 UI 布局。 */
export function isBlankFinalAnswerMessage(message: BaseMessage): boolean {
  return message.type === 'final_answer' && isBlankAnswerContent(message.content);
}

export function isHiddenConversationMessage(message: BaseMessage): boolean {
  if (readUiPresentation(message) === 'hidden') return true;
  return false;
}

/**
 * 对话「是否有可见内容」判定（空态、selectors、timeline 入口等）。
 * 只统计用户/助手侧栏里真正有意义的可见消息。
 */
export function isRenderableConversationMessage(message: BaseMessage): boolean {
  if (isHiddenConversationMessage(message)) return false;
  if (isBlankFinalAnswerMessage(message)) return false;

  if (message.role === 'user' || message.role === 'assistant') return true;
  return false;
}

/**
 * UI 消息列表 / Message.vue 的「是否渲染这条消息」判定。
 * 范围比 isRenderableConversationMessage 更广（例如 history_summary 仍要渲染）。
 */
export function shouldRenderConversationMessage(message: BaseMessage): boolean {
  if (isHiddenConversationMessage(message)) return false;
  if (isBlankFinalAnswerMessage(message)) return false;
  return true;
}

export function hasRenderableConversationMessages(messages: readonly BaseMessage[]): boolean {
  return messages.some(isRenderableConversationMessage);
}
