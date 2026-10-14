import type {
  ConversationClientNoticeCommand,
  ConversationClientNoticeReceipt,
} from '@app/schemas';

export type ConversationClientNoticeAdmissionResult =
  | { readonly status: 'accepted'; readonly receipt: ConversationClientNoticeReceipt }
  | { readonly status: 'conversation-not-found' }
  | { readonly status: 'identity-conflict' };

/** 狭窄产品事实入口，不授予 run、工具或模型调用权限。 */
export interface ConversationClientNoticeAdmissionPort {
  accept(conversationId: string, notice: ConversationClientNoticeCommand): ConversationClientNoticeAdmissionResult;
}
