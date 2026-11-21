import { Router } from 'express';
import { ConversationActivityListSchema } from '@app/schemas';
import {
  listConversationActivities,
  type ConversationActivityListPorts,
} from '../../../app-hosts/linnya/application/conversation-activity';
import { getLogger } from '../../../shared/logger';

const logger = getLogger('ConversationActivityRouter');

/**
 * 侧栏运行状态的读取入口：只读、不缓存，错误只返回 code。何时重读由 Host 的
 * conversation-activity-changed 失效信号决定，见 conversation-activity README。
 */
export function createConversationActivityRouter(ports: ConversationActivityListPorts): Router {
  const router = Router();
  router.get('/activity', async (_request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      response.json(ConversationActivityListSchema.parse(await listConversationActivities(ports)));
    } catch (error: unknown) {
      logger.error('读取对话运行状态失败', { errorName: error instanceof Error ? error.name : typeof error });
      response.status(500).json({ code: 'conversation_activity.list_failed' });
    }
  });
  return router;
}
