import type { RendererAiInvocationUserQuote } from '@plugin/renderer/aiInvocationPort';
import type {
  ConversationAttachmentRef,
  ConversationAttachmentSelection,
} from '@app/schemas';

/**
 * Renderer 内部的一条完整用户消息内容。
 *
 * 用户消息的可重放内容必须聚合在同一个合同里，避免编辑、重新生成和普通发送
 * 分别复制字段，导致引用、附件等 durable 上下文在不同入口发生漂移。
 */
export interface UserMessageContent {
  readonly text: string;
  readonly userQuote?: RendererAiInvocationUserQuote;
  readonly attachments?: readonly ConversationAttachmentRef[];
}

export interface EditUserMessageCommand {
  readonly messageId: string;
  readonly text: string;
  /** 编辑会话冻结的有序附件选择；draft/durable 身份不会进入消息聚合。 */
  readonly attachmentSelection: ConversationAttachmentSelection;
}

export interface RegenerateUserMessageCommand {
  readonly messageId: string;
}
