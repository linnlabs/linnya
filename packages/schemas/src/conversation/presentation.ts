import { z } from 'zod';

/** durable Conversation row 允许的展示方式；卡片不是 timeline presentation。 */
export const ConversationUiPresentationSchema = z.enum(['message', 'hidden']);
export type ConversationUiPresentation = z.infer<typeof ConversationUiPresentationSchema>;

/** 请求进入 Runtime metadata 时使用的最小展示合同。 */
export const ConversationUiSpecSchema = z.object({
  presentation: ConversationUiPresentationSchema,
}).strict();
export type ConversationUiSpec = z.infer<typeof ConversationUiSpecSchema>;
