import { z } from 'zod';

/** 客户端只报告故障类别，禁止把 Provider 原文、请求正文或凭据上传成历史消息。 */
export const ConversationClientNoticeCommandSchema = z.object({
  notice_id: z.string().uuid(),
  observed_at: z.number().finite().nonnegative(),
  error_kind: z.enum(['connection', 'http', 'projection', 'control', 'validation', 'annotation', 'unknown']),
  operation: z.enum(['send', 'continue', 'pause', 'cancel', 'load', 'annotation', 'select_agent', 'validate']),
  reason_code: z.enum(['missing_project', 'legacy_research_unavailable', 'missing_conversation', 'missing_message', 'agent_choice_not_saved', 'missing_context']).optional(),
  http_status: z.number().int().min(400).max(599).optional(),
}).strict();
export type ConversationClientNoticeCommand = z.infer<typeof ConversationClientNoticeCommandSchema>;

/** 产品事实，不是 RuntimeEvent；接纳不代表 Agent 已开始、暂停或失败。 */
export const ConversationClientNoticePayloadSchema = ConversationClientNoticeCommandSchema.extend({
  origin: z.literal('client'),
}).strict();
export type ConversationClientNoticePayload = z.infer<typeof ConversationClientNoticePayloadSchema>;

export const ConversationClientNoticeReceiptSchema = z.object({
  state: z.enum(['retained', 'removed']),
  conversation_id: z.string().trim().min(1),
  accepted_at: z.number().finite().nonnegative(),
  notice: ConversationClientNoticePayloadSchema,
}).strict();
export type ConversationClientNoticeReceipt = z.infer<typeof ConversationClientNoticeReceiptSchema>;

export function conversationMessageIdFromClientNoticeId(noticeId: string): string {
  return `client-notice:${z.string().uuid().parse(noticeId)}`;
}
