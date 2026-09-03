/**
 * @file src/app-hosts/linnya/adapters/flow/flow.router.ts
 */

import express, { Router, Response } from 'express';
import { Logger } from 'src/shared/logger';
import { FlowOrchestrator } from './flow.orchestrator';
import {
  validateConversationInteractionResponseRequest,
  validateConversationNextRequest,
  validateConversationRunCancelRequest,
} from '@app/schemas';
import type { SSESink } from './flow.schemas';
import { admitConversationAgentChoice } from './functions/admitConversationAgentChoice';

const logger = new Logger('FlowRouter');
const CONVERSATION_NEXT_BODY_LIMIT = '50mb';

/**
 * 写入SSE事件到响应流
 *
 * @param {Response} res - Express响应对象
 * @param {string} event - SSE事件类型
 * @param {unknown} data - 事件数据
 *
 * Side-effects:
 * - 向HTTP响应流写入SSE格式的数据
 */
function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);

  /**
   * 🔎 诊断日志（开发期）：追踪“谁写出了 event:error”
   *
   * 你现在看到的现象是：前端收到了 SSE `event: error`，但 JSON 里 `error/error_code/details` 都是 undefined。
   * 这只可能发生在“后端写出了 event:error，但 data 不是 SSEErrorEvent（缺少 error 字段）”的情况下。
   *
   * 这里在写出 error 时打印调用栈，下一次复现就能直接定位到具体调用点（根因，不靠猜）。
   */
  if (process.env.NODE_ENV !== 'production' && event === 'error') {
    const keys = data && typeof data === 'object' ? Object.keys(data) : [];
    logger.error('[FlowRouter][SSE] wrote event:error (diagnostics)', {
      writableEnded: res.writableEnded,
      dataType: typeof data,
      dataKeys: keys,
      dataJson: JSON.stringify(data),
      stack: new Error('FlowRouter.writeSse(event=error) stack').stack,
    });
  }
}

/**
 * 创建对话流路由
 *
 * 提供API层用于处理对话流请求，只关心HTTP请求和响应。
 * 它负责解析请求、验证、设置SSE、处理连接取消，然后调用编排器。
 *
 * @param {FlowOrchestrator} orchestrator - 流程编排器，负责协调整个对话流程
 * @returns {Router} Express路由器实例
 *
 * Side-effects:
 * - 注册HTTP路由处理器
 */
export function createConversationFlowRouter(orchestrator: FlowOrchestrator): Router {
  const router = Router();

  router.get('/conversations/:conversationId/runs/active', (req, res) => {
    void orchestrator.getActiveForegroundRun(req.params.conversationId)
      .then(response => res.json(response))
      .catch((error: unknown) => {
        logger.error('Active foreground run query failed', {
          conversationId: req.params.conversationId,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(409).json({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });

  router.get('/conversations/:conversationId/runs/:runId/settlement', (req, res) => {
    void orchestrator.getForegroundRunSettlement(
      req.params.conversationId,
      req.params.runId,
    )
      .then(response => res.json(response))
      .catch((error: unknown) => {
        logger.error('Foreground run settlement query failed', {
          conversationId: req.params.conversationId,
          runId: req.params.runId,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(409).json({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });

  router.post('/runs/:runId/cancel', express.json(), (req, res) => {
    const validation = validateConversationRunCancelRequest(req.body);
    if (!validation.success) {
      res.status(400).json({ success: false, error: 'Invalid run cancellation request' });
      return;
    }
    void orchestrator.cancelRun(req.params.runId, validation.data.conversation_id, validation.data.reason)
      .then(response => res.json(response))
      .catch((error: unknown) => {
        logger.error('Run cancellation failed', {
          runId: req.params.runId,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(409).json({ success: false, error: error instanceof Error ? error.message : String(error) });
      });
  });

  router.post(
    '/runs/:runId/interactions/:interactionId/respond',
    express.json({ limit: CONVERSATION_NEXT_BODY_LIMIT }),
    (req, res) => {
      const validation = validateConversationInteractionResponseRequest(req.body);
      if (!validation.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid interaction response',
          details: validation.error.format(),
        });
        return;
      }
      const command = validation.data;
      if (req.params.runId !== command.run_id || req.params.interactionId !== command.interaction_id) {
        res.status(409).json({
          success: false,
          error: 'Interaction identity does not match request path',
        });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const abortController = new AbortController();
      const onClose = (): void => {
        if (!res.writableEnded) abortController.abort('client_disconnected');
      };
      res.on('close', onClose);
      const sseSink: SSESink = (event): void => {
        writeSse(res, event.type, event);
      };

      void orchestrator.respondInteraction(command, sseSink, abortController.signal)
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === 'AbortError') return;
          logger.error('Interaction response failed', {
            runId: command.run_id,
            interactionId: command.interaction_id,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          res.off('close', onClose);
          res.end();
        });
    },
  );

  /**
   * POST /next
   * 执行下一轮对话
   *
   * 请求体应符合 ConversationNextRequest 格式
   * 响应使用 Server-Sent Events (SSE) 流式传输
   */
  router.post('/next', express.json({ limit: CONVERSATION_NEXT_BODY_LIMIT }), (req, res) => {
    // 设置SSE响应头（必须在任何写入前设置）
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 创建会话级 AbortController，用于取消后端 AI 活动
    const abortController = new AbortController();
    let isCancelled = false;

    /**
     * 监听连接 close：用于“客户端提前断开连接”时取消后端活动
     *
     * ⚠️ 根因级说明（对应你看到的现象）：
     * - Node/Express 下 `res` 的 `close` 事件在“正常结束响应”时也可能触发；
     * - 如果我们不区分“正常结束 vs 客户端提前断开”，就会把每次请求都当作取消，
     *   导致 abortSignal 被触发，上游抛 AbortError，最终前端收到一条莫名其妙的 error SSE。
     *
     * 结论：
     * - 只有在 **response 尚未正常结束** 的情况下收到 close，才视为“客户端提前断开”。
     */
    const closeHandler = () => {
      // 响应已正常结束时，close 不应视为客户端取消。
      if (res.writableEnded) return;

      if (!isCancelled) {
        logger.info('Client disconnected SSE connection, aborting backend AI activities', {
          reason: 'client_disconnected',
        });
        isCancelled = true;
        abortController.abort('client_disconnected');
        res.off('close', closeHandler);
      }
    };
    res.on('close', closeHandler);

    // 公共处理函数：接收已解析的 requestBody
    const handleValidatedRequest = async (requestBody: unknown): Promise<void> => {
      // 使用Zod验证请求体
      const validation = validateConversationNextRequest(requestBody);
      if (!validation.success) {
        logger.error('Request validation failed', {
          body: requestBody,
          errors: validation.error.format()
        });
        res.status(400).json({
          success: false,
          error: 'Invalid request format',
          details: validation.error.format(),
        });
        return;
      }

      let body: typeof validation.data;
      try {
        body = admitConversationAgentChoice(validation.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Conversation agent admission failed', {
          conversationId: validation.data.conversation_id,
          selectedAgentId: validation.data.options?.selected_agent_id,
          error: message,
        });
        res.status(400).json({ success: false, error: message });
        return;
      }

      logger.info('Processing conversation next request', {
        conversationId: body.conversation_id,
        projectId: body.project_id, // 👈 添加日志
        hasNewEvents: (body.new_events || []).length > 0,
      });

      // 创建SSE事件发送器
      const sseSink: SSESink = (event): void => {
        writeSse(res, event.type, event);
      };

      try {
        // 调用编排器执行对话流程
        const result = await orchestrator.next(body, sseSink, abortController.signal, {
          persist: body.options?.persist
        });

        // 🔍 调试：记录本次运行返回的事件数量（仅用于持久化，不再通过这里发送 SSE）
        logger.info('[FlowRouter] Orchestrator.next completed', {
          conversationId: result.conversation_id,
          returnedEvents: result.events?.length ?? 0
        });

        // run_status / transport_end 由 Host session 统一收尾，Router 禁止重复发送。
      } catch (error: unknown) {
        /**
         * ✅ 根因级收敛：路由层不再写逻辑层 SSE 事件
         *
         * 中文备注：
         * - admission 后错误由 RuntimeEventPublisher 发布，Host session 发 run_status / transport_end；
         * - router 只负责连接生命周期（close 监听 + res.end），避免异常路径重复造语义事件。
         */
        const errorMsg = error instanceof Error ? error.message : String(error);

        // 仅连接生命周期中断才在此处静默收尾；业务 AbortError 仍交由 Host settlement 记录。
        if ((error instanceof Error && error.name === 'AbortError') || isCancelled) {
          logger.info('Request stream interrupted', {
            errorMsg,
            reason: abortController.signal.reason,
            source: isCancelled ? 'client_disconnected' : 'run_cancelled',
          });
          return;
        }

        logger.error(`Request processing failed: ${errorMsg}`, {
          stack: error instanceof Error ? error.stack : undefined,
        });
      } finally {
        // 清理监听器并结束响应
        res.off('close', closeHandler);
        res.end();
      }
    };

    void handleValidatedRequest(req.body);
  });

  return router;
}
