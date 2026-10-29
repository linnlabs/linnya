import type { ConversationClientNoticeCommand } from '@app/schemas';

/** 安全文案只依赖失败原因，不要求创建持久通知或伪造消息身份。 */
export type ConversationOperationFailure = Pick<
  ConversationClientNoticeCommand,
  'operation' | 'error_kind' | 'http_status' | 'reason_code'
>;
