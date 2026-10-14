import { z } from 'zod';
import { ConversationClientNoticeCommandSchema } from '@app/schemas';

export const LocalClientNoticeSchema = z.object({
  command: ConversationClientNoticeCommandSchema,
  conversationId: z.string().min(1).nullable(),
  draftKey: z.string().min(1),
  acceptedAt: z.number().finite().nonnegative().nullable(),
}).strict();
export type LocalClientNotice = z.infer<typeof LocalClientNoticeSchema>;
export const LocalClientNoticesSchema = z.array(LocalClientNoticeSchema);

export type ClientNoticeMessage = Extract<import('../../../types').BaseMessage, { type: 'client_notice' }>;
