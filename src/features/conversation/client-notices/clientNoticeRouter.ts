import { Router } from 'express';
import {
  ConversationClientNoticeCommandSchema,
  ConversationClientNoticeReceiptSchema,
} from '@app/schemas';
import type { ConversationClientNoticeAdmissionPort } from './clientNoticeAdmission';

/** 与 History 挂在同一受保护的 Conversation API；不调用 Flow 或 Agent。 */
export function createConversationClientNoticeRouter(port: ConversationClientNoticeAdmissionPort): Router {
  const router = Router();
  router.put('/:id/client-notices/:noticeId', (request, response) => {
    const parsed = ConversationClientNoticeCommandSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.notice_id !== request.params.noticeId) {
      return response.status(400).json({ error: 'CLIENT_NOTICE_INVALID' });
    }
    const result = port.accept(request.params.id, parsed.data);
    if (result.status === 'conversation-not-found') {
      return response.status(404).json({ error: 'CONVERSATION_NOT_FOUND' });
    }
    if (result.status === 'identity-conflict') {
      return response.status(409).json({ error: 'CLIENT_NOTICE_IDENTITY_CONFLICT' });
    }
    return response.json(ConversationClientNoticeReceiptSchema.parse(result.receipt));
  });
  return router;
}
