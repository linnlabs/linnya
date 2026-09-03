import type { BaseMessage } from '../types';

/**
 * 克隆一条正式 Conversation 消息，同时保留 type 与 metadata 的判别关系。
 *
 * 禁止用 `{ ...message, metadata: { ...message.metadata } }` 克隆 BaseMessage：这种写法会把
 * 判别联合拆成互不关联的字段，后续很容易把 thought metadata 配到 tool_calls 上。
 */
export function cloneConversationMessage(message: BaseMessage): BaseMessage {
  const attachments = message.attachments ? [...message.attachments] : undefined;
  const citationDependencies = message.citationDependencies
    ? {
        citations: message.citationDependencies.citations.map(citation => ({ ...citation })),
        unresolved_refs: [...message.citationDependencies.unresolved_refs],
      }
    : undefined;
  switch (message.type) {
    case 'user_input':
      return {
        ...message,
        ...(attachments ? { attachments } : {}),
        ...(message.metadata ? { metadata: { ...message.metadata } } : {}),
        ...(citationDependencies ? { citationDependencies } : {}),
      };
    case 'thought':
      return {
        ...message,
        ...(attachments ? { attachments } : {}),
        ...(citationDependencies ? { citationDependencies } : {}),
        metadata: { ...message.metadata },
      };
    case 'tool_calls':
      return {
        ...message,
        ...(attachments ? { attachments } : {}),
        ...(citationDependencies ? { citationDependencies } : {}),
        metadata: { ...message.metadata },
      };
    case 'final_answer':
      return {
        ...message,
        ...(attachments ? { attachments } : {}),
        ...(citationDependencies ? { citationDependencies } : {}),
        metadata: { ...message.metadata },
      };
    case 'tool_preamble':
      return {
        ...message,
        ...(attachments ? { attachments } : {}),
        ...(citationDependencies ? { citationDependencies } : {}),
        metadata: { ...message.metadata },
      };
    case 'partial_answer':
      return {
        ...message,
        ...(attachments ? { attachments } : {}),
        ...(citationDependencies ? { citationDependencies } : {}),
        metadata: { ...message.metadata },
      };
    case 'history_summary':
      return {
        ...message,
        ...(attachments ? { attachments } : {}),
        ...(citationDependencies ? { citationDependencies } : {}),
        metadata: { ...message.metadata },
      };
    case 'summarization_progress':
      return {
        ...message,
        ...(attachments ? { attachments } : {}),
        ...(citationDependencies ? { citationDependencies } : {}),
        metadata: { ...message.metadata },
      };
  }
}
