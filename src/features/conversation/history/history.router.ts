/**
 * @file src/features/conversation/history/history.router.ts
 * @description 对话历史管理 API 路由层（API Router Layer）
 *
 * 功能 (What):
 * 处理所有与历史记录管理相关的 HTTP 请求，包括：
 * - GET /list - 获取会话列表
 * - GET /:id/events/paginated - 获取分页的事件列表
 * - GET /:id/metadata - 获取会话元数据
 * - PUT /:id/title - 更新会话标题
 * - PUT /:id/pinned - 更新会话置顶状态
 * - DELETE /:id - 删除会话
 *
 * 输入 (Input):
 * - HistoryService 实例（通过工厂函数参数注入）
 * - HTTP 请求对象（Request）
 *
 * 输出 (Output):
 * - Express Router 实例
 * - HTTP 响应（JSON 格式）
 *
 * 副作用 (Side-effects):
 * - 通过 Service 层间接操作数据库
 * - 发送 HTTP 响应给客户端
 * - 记录日志信息
 *
 * 设计原则:
 * - 单一职责：只负责 HTTP 请求的处理和响应
 * - 依赖注入：依赖 Service 层抽象
 * - 统一错误处理：所有错误都被捕获并返回标准格式
 * - 参数验证：在路由层进行基本的参数校验
 */

import { Router, Request, Response } from 'express';
import { HistoryService } from './history.service';
import { Logger } from '../../../shared/logger';
import {
  SubrunTraceQuerySchema,
  UiMessagesAroundQuerySchema,
  UiMessagesCursorQuerySchema,
  UiMessagesLimitQuerySchema,
} from './ui-messages.schemas';
import type {
  ConversationSubrunTraceResponse,
  ConversationTurnIndexResponse,
  UiMessagesWindowResponse,
} from './ui-messages.schemas';
import {
  ConversationCleanupRetryResponseSchema,
  UpdateConversationSelectedAgentRequestSchema,
} from '@app/schemas';

const logger = new Logger('HistoryRouter');

/**
 * 创建历史记录路由器
 *
 * 功能 (What): 工厂函数，创建并配置历史记录管理的所有路由
 *
 * 输入 (Input):
 * @param service - HistoryService 实例
 *
 * 输出 (Output):
 * @returns Express Router 实例，包含所有配置好的路由
 *
 * 副作用 (Side-effects):
 * - 创建新的 Router 实例并配置路由规则
 */
export function createHistoryRouter(service: HistoryService): Router {
  const router = Router();

  /**
   * 路由 1: GET /list
   * 获取会话列表（分页）
   *
   * 功能 (What): 获取用户的会话列表，支持分页和搜索
   *
   * 查询参数 (Query Parameters):
   * @param limit - 每页数量 (默认 30，最大 100)
   * @param cursor - opaque string keyset 游标
   * @param search - 搜索关键词 (可选)
   *
   * 响应格式 (Response):
   * {
   *   success: true,
   *   conversations: ConversationListItem[],
   *   next_cursor?: string,
   *   has_more: boolean
   * }
   */
  router.get('/list', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 30;
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const search = req.query.search as string | undefined;
      const projectIdRaw = req.query.projectId as string | undefined; // 新增：获取 projectId
      const projectId = typeof projectIdRaw === 'string' ? projectIdRaw.trim() : undefined;

      logger.info('List conversations request', { limit, cursor, search, projectId });

      const result = await service.listConversations({ limit, cursor, search, projectId });

      res.json({
        success: true,
        ...result,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'unknown_error';
      logger.error('Failed to list conversations', error);

      res.status(500).json({
        success: false,
        error: 'Failed to list conversations',
        details: errorMessage,
      });
    }
  });

  router.get('/:id/ui-messages/tail', async (req: Request, res: Response) => {
    try {
      const conversationId = readConversationId(req);
      if (!conversationId) {
        return sendMissingConversationId(res);
      }

      const parsed = UiMessagesLimitQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendInvalidQuery(res, parsed.error.message);
      }

      const result = await service.readUiMessagesTail(conversationId, parsed.data.limit);
      return sendUiMessagesWindow(res, result);
    } catch (error: unknown) {
      return sendRouteError(res, 'Failed to read UI messages tail', error);
    }
  });

  router.get('/:id/ui-messages/before', async (req: Request, res: Response) => {
    try {
      const conversationId = readConversationId(req);
      if (!conversationId) {
        return sendMissingConversationId(res);
      }

      const parsed = UiMessagesCursorQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendInvalidQuery(res, parsed.error.message);
      }

      const result = await service.readUiMessagesBefore(
        conversationId,
        parsed.data.cursor,
        parsed.data.limit,
      );
      return sendUiMessagesWindow(res, result);
    } catch (error: unknown) {
      return sendRouteError(res, 'Failed to read UI messages before cursor', error);
    }
  });

  router.get('/:id/ui-messages/after', async (req: Request, res: Response) => {
    try {
      const conversationId = readConversationId(req);
      if (!conversationId) {
        return sendMissingConversationId(res);
      }

      const parsed = UiMessagesCursorQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendInvalidQuery(res, parsed.error.message);
      }

      const result = await service.readUiMessagesAfter(
        conversationId,
        parsed.data.cursor,
        parsed.data.limit,
      );
      return sendUiMessagesWindow(res, result);
    } catch (error: unknown) {
      return sendRouteError(res, 'Failed to read UI messages after cursor', error);
    }
  });

  router.get('/:id/ui-messages/around', async (req: Request, res: Response) => {
    try {
      const conversationId = readConversationId(req);
      if (!conversationId) {
        return sendMissingConversationId(res);
      }

      const parsed = UiMessagesAroundQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendInvalidQuery(res, parsed.error.message);
      }

      const result = await service.readUiMessagesAround(
        conversationId,
        parsed.data.anchor_message_id,
        parsed.data.limit,
      );
      return sendUiMessagesWindow(res, result);
    } catch (error: unknown) {
      return sendRouteError(res, 'Failed to read UI messages around anchor', error);
    }
  });

  router.get('/:id/turns', async (req: Request, res: Response) => {
    try {
      const conversationId = readConversationId(req);
      if (!conversationId) {
        return sendMissingConversationId(res);
      }

      const result = await service.readTurnIndex(conversationId);
      return sendTurnIndex(res, result);
    } catch (error: unknown) {
      return sendRouteError(res, 'Failed to read conversation turns', error);
    }
  });

  router.get('/:id/subrun-trace', async (req: Request, res: Response) => {
    try {
      const conversationId = readConversationId(req);
      if (!conversationId) {
        return sendMissingConversationId(res);
      }

      const parsed = SubrunTraceQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendInvalidQuery(res, parsed.error.message);
      }

      const result = await service.readSubrunTrace(
        conversationId,
        parsed.data.parent_tool_call_id,
        parsed.data.subrun_id,
        {
          kinds: parsed.data.kinds,
          limit: parsed.data.limit,
          cursor: parsed.data.cursor,
        },
      );
      return sendSubrunTrace(res, result);
    } catch (error: unknown) {
      return sendRouteError(res, 'Failed to read subrun trace', error);
    }
  });

  /**
   * 路由 2: GET /:id/events/paginated
   * 获取会话事件（分页，支持反向加载）
   *
   * 功能 (What): 获取指定会话的事件历史，支持分页和方向控制
   *
   * 路径参数 (Path Parameters):
   * @param id - 会话ID
   *
   * 查询参数 (Query Parameters):
   * @param limit - 每页数量 (默认 50，最大 200)
   * @param cursor - 游标 (事件序号)
   * @param direction - 'forward' | 'backward' (默认 'backward')
   *
   * 响应格式 (Response):
   * {
   *   success: true,
   *   conversation_id: string,
   *   events: RuntimeEvent[],
   *   next_cursor?: number,
   *   has_more: boolean,
   *   revision: number
   * }
   */
  router.get('/:id/events/paginated', async (req: Request, res: Response) => {
    try {
      const conversationId = String(req.params.id || '').trim();

      if (!conversationId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameter: conversationId',
        });
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const cursor = req.query.cursor ? parseInt(req.query.cursor as string) : undefined;
      const direction = (req.query.direction as 'forward' | 'backward') || 'backward';

      const result = await service.readConversationEvents(conversationId, {
        limit,
        cursor,
        direction,
      });

      res.json({
        success: true,
        conversation_id: conversationId,
        ...result,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'unknown_error';
      logger.error('Failed to read conversation events', error);

      res.status(500).json({
        success: false,
        error: 'Failed to read conversation events',
        details: errorMessage,
      });
    }
  });

  /**
   * 路由 3: GET /:id/metadata
   * 获取会话元数据
   *
   * 功能 (What): 获取指定会话的元数据信息
   *
   * 路径参数 (Path Parameters):
   * @param id - 会话ID
   *
   * 响应格式 (Response):
   * {
   *   success: true,
   *   conversation_id: string,
   *   title: string,
   *   created_at: number,
   *   last_event_at: number,
   *   event_count: number,
   *   current_revision: number
   * }
   */
  router.get('/:id/metadata', async (req: Request, res: Response) => {
    try {
      const conversationId = String(req.params.id || '').trim();

      if (!conversationId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameter: conversationId',
        });
      }

      logger.info('Get metadata request', { conversationId });

      const metadata = await service.getConversationMetadata(conversationId);

      if (!metadata) {
        return res.status(404).json({
          success: false,
          error: 'Conversation not found',
        });
      }

      res.json({
        success: true,
        ...metadata,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'unknown_error';
      logger.error('Failed to get conversation metadata', error);

      res.status(500).json({
        success: false,
        error: 'Failed to get conversation metadata',
        details: errorMessage,
      });
    }
  });

  /**
   * 路由 4: PUT /:id/title
   * 更新会话标题
   *
   * 功能 (What): 修改指定会话的标题
   *
   * 路径参数 (Path Parameters):
   * @param id - 会话ID
   *
   * 请求体 (Request Body):
   * {
   *   title: string
   * }
   *
   * 响应格式 (Response):
   * {
   *   success: true,
   *   message: 'Title updated successfully'
   * }
   */
  router.put('/:id/title', async (req: Request, res: Response) => {
    try {
      const conversationId = String(req.params.id || '').trim();
      const { title } = req.body;

      if (!conversationId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameter: conversationId',
        });
      }

      if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Invalid or missing title',
        });
      }

      logger.info('Update title request', { conversationId, title });

      const success = await service.updateConversationTitle(conversationId, title.trim());

      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'Conversation not found',
        });
      }

      res.json({
        success: true,
        message: 'Title updated successfully',
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'unknown_error';
      logger.error('Failed to update conversation title', error);

      res.status(500).json({
        success: false,
        error: 'Failed to update conversation title',
        details: errorMessage,
      });
    }
  });

  router.put('/:id/selected-agent', async (req: Request, res: Response) => {
    try {
      const conversationId = String(req.params.id || '').trim();
      if (!conversationId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameter: conversationId',
        });
      }

      const parsed = UpdateConversationSelectedAgentRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid selected agent request',
          details: parsed.error.format(),
        });
      }

      const success = await service.updateConversationSelectedAgent(
        conversationId,
        parsed.data.selected_agent_id,
        parsed.data.project_id,
      );
      if (!success) {
        return res.status(404).json({ success: false, error: 'Conversation not found' });
      }

      return res.json({
        success: true,
        selected_agent_id: parsed.data.selected_agent_id,
      });
    } catch (error: unknown) {
      return sendRouteError(res, 'Failed to update selected agent', error);
    }
  });

  /**
   * 路由 5: PUT /:id/pinned
   * 更新会话置顶状态
   */
  router.put('/:id/pinned', async (req: Request, res: Response) => {
    try {
      const conversationId = String(req.params.id || '').trim();
      const { pinned } = req.body;

      if (!conversationId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameter: conversationId',
        });
      }

      if (typeof pinned !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'Invalid or missing pinned',
        });
      }

      logger.info('Update pinned request', { conversationId, pinned });

      const result = await service.updateConversationPinned(conversationId, pinned);

      if (!result.success) {
        return res.status(404).json({
          success: false,
          error: 'Conversation not found',
        });
      }

      res.json({
        success: true,
        is_pinned: result.isPinned,
        pinned_at: result.pinnedAt,
        message: 'Pinned state updated successfully',
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'unknown_error';
      logger.error('Failed to update conversation pinned state', error);

      res.status(500).json({
        success: false,
        error: 'Failed to update conversation pinned state',
        details: errorMessage,
      });
    }
  });

  /**
   * 路由 6: DELETE /:id
   * 删除会话
   *
   * 功能 (What): 删除指定的会话及其所有事件（不可逆操作）
   *
   * 路径参数 (Path Parameters):
   * @param id - 会话ID
   *
   * 响应格式 (Response):
   * {
   *   success: true,
   *   message: 'Conversation deleted successfully'
   * }
   */
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const conversationId = String(req.params.id || '').trim();

      if (!conversationId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameter: conversationId',
        });
      }

      logger.info('Delete conversation request', { conversationId });

      const success = await service.deleteConversation(conversationId);

      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'Conversation not found',
        });
      }

      res.json({
        success: true,
        message: 'Conversation deleted successfully',
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'unknown_error';
      logger.error('Failed to delete conversation', error);

      res.status(500).json({
        success: false,
        error: 'Failed to delete conversation',
        details: errorMessage,
      });
    }
  });

  router.post('/:id/cleanup/retry', async (req: Request, res: Response) => {
    try {
      const conversationId = readConversationId(req);
      if (!conversationId) return sendMissingConversationId(res);
      const outcome = await service.retryPendingCleanup(conversationId);
      return res.json(ConversationCleanupRetryResponseSchema.parse({
        success: true,
        outcome,
      }));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'unknown_error';
      logger.error('Failed to retry conversation cleanup', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to retry conversation cleanup',
        details: errorMessage,
      });
    }
  });

  return router;
}

function readConversationId(req: Request): string {
  return String(req.params.id || '').trim();
}

function sendMissingConversationId(res: Response): Response {
  return res.status(400).json({
    success: false,
    error: 'Missing required parameter: conversationId',
  });
}

function sendInvalidQuery(res: Response, details: string): Response {
  return res.status(400).json({
    success: false,
    error: 'Invalid query parameters',
    details,
  });
}

function sendUiMessagesWindow(res: Response, result: UiMessagesWindowResponse): Response {
  if (result.status === 'preparing') {
    return res.status(409).json({
      success: false,
      status: 'preparing',
      conversation_id: result.conversation_id,
    });
  }

  if (result.status === 'anchor-not-found') {
    return res.status(404).json({
      success: false,
      error: 'Anchor message not found',
      conversation_id: result.conversation_id,
      anchor_message_id: result.anchor_message_id,
    });
  }

  return res.json({
    success: true,
    conversation_id: result.conversation_id,
    messages: result.messages,
    citation_dependencies: result.citation_dependencies,
    has_more_before: result.has_more_before,
    has_more_after: result.has_more_after,
    prev_cursor: result.prev_cursor,
    next_cursor: result.next_cursor,
    revision: result.revision,
  });
}

function sendTurnIndex(res: Response, result: ConversationTurnIndexResponse): Response {
  if (result.status === 'preparing') {
    return res.status(409).json({
      success: false,
      status: 'preparing',
      conversation_id: result.conversation_id,
    });
  }

  return res.json({
    success: true,
    conversation_id: result.conversation_id,
    turns: result.turns,
    revision: result.revision,
  });
}

function sendSubrunTrace(res: Response, result: ConversationSubrunTraceResponse): Response {
  if (result.status === 'preparing') {
    return res.status(409).json({
      success: false,
      status: 'preparing',
      conversation_id: result.conversation_id,
    });
  }

  return res.json({
    success: true,
    conversation_id: result.conversation_id,
    parent_tool_call_id: result.parent_tool_call_id,
    subrun_id: result.subrun_id,
    events: result.events,
    next_cursor: result.next_cursor,
    revision: result.revision,
  });
}

function sendRouteError(res: Response, message: string, error: unknown): Response {
  const errorMessage = error instanceof Error ? error.message : 'unknown_error';
  logger.error(message, error);

  return res.status(500).json({
    success: false,
    error: message,
    details: errorMessage,
  });
}
