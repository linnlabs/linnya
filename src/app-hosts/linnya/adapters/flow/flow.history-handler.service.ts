/**
 * @file src/app-hosts/linnya/adapters/flow/flow.history-handler.service.ts
 * @description 历史事件处理服务（History Handler Service）
 *
 * 功能 (What):
 * 封装对话流程执行前的历史预处理操作，包括：
 * - 处理历史截断操作（编辑重发场景）
 * - 为后续的 Runner 提供干净的上下文环境
 *
 * 输入 (Input):
 * - ConversationNextRequest（会话请求）
 * - conversationId（会话ID）
 *
 * 输出 (Output):
 * - 操作结果对象，包含是否发生了截断
 * - 历史事件数组
 *
 * 副作用 (Side-effects):
 * - 可能截断历史记录
 *
 * 设计原则:
 * - 单一职责：只负责运行前的历史预处理
 * - 依赖注入：通过 Repository 访问数据
 * - 不负责事件追加（由 Runner 在运行结束后负责）
 */

import type { ConversationNextRequest, RuntimeEvent } from 'src/app-hosts/linnya/adapters/flow/flow.schemas';
import { Logger } from 'src/shared/logger';

const logger = new Logger('HistoryHandlerService');

/**
 * 历史处理结果接口
 */
export interface HistoryProcessResult {
  /** 是否发生了截断操作 */
  truncateHappened: boolean;
  /** 被删除的 durable event 数量。 */
  deletedEventCount: number;
  /** 被删除的 run 数量。 */
  deletedRunCount: number;
}

export interface FlowHistoryReadResult {
  events: RuntimeEvent[];
  revision: number;
}

/**
 * Flow host application layer 的最小 history access port。
 *
 * 中文备注：
 * - Flow pre-run policy 只需要“截断历史”和“读取 foreground 正文历史”；
 * - 不应直接依赖整个 history domain repository。
 */
export interface FlowHistoryAccessPort {
  truncateFromEvent(
    conversationId: string,
    eventId: string,
  ): Promise<{ found: boolean; deletedEventCount: number; deletedRunCount: number }>;
  readForegroundFrom(
    conversationId: string,
    fromRevision?: number,
  ): Promise<FlowHistoryReadResult>;
}

export function createFlowHistoryAccessPort(
  historyAccessDelegate: FlowHistoryAccessPort,
): FlowHistoryAccessPort {
  return {
    truncateFromEvent: historyAccessDelegate.truncateFromEvent.bind(historyAccessDelegate),
    readForegroundFrom: historyAccessDelegate.readForegroundFrom.bind(historyAccessDelegate),
  };
}

/**
 * 历史事件处理服务类
 */
export class HistoryHandlerService {
  /**
   * 构造函数
   *
   * 功能 (What): 初始化服务，注入 HistoryRepository 依赖
   *
   * @param historyAccessPort - Flow 历史访问端口
   */
  constructor(private readonly historyAccessPort: FlowHistoryAccessPort) {}


  /**
   * 处理历史截断（如果需要）
   *
   * 功能 (What): 根据请求参数，可能执行历史截断操作
   *
   * 输入 (Input):
   * @param req - 会话请求
   * @param conversationId - 会话ID
   *
   * 输出 (Output):
   * @returns Promise<HistoryProcessResult> 包含截断操作的结果
   *
   * 副作用 (Side-effects):
   * - 可能截断历史记录
   *
   * 实现细节:
   * - 如果有 truncateFromMessageId，从目标消息开始执行 inclusive 截断
   * - 不再负责事件追加（由 Runner 在执行完成后负责）
   */
  async processEvents(req: ConversationNextRequest, conversationId: string): Promise<HistoryProcessResult> {
    const truncateHappened = !!req.options?.truncateFromMessageId;
    let deletedEventCount = 0;
    let deletedRunCount = 0;

    if (truncateHappened && req.options?.truncateFromMessageId) {
      // 执行截断操作
      logger.info(`Truncating history from message: messageId=${req.options.truncateFromMessageId}, reason=${req.options.truncateReason}`);

      const targetId = req.options.truncateFromMessageId;
      const result = await this.historyAccessPort.truncateFromEvent(conversationId, targetId);

      if (result.found) {
        deletedEventCount = result.deletedEventCount;
        deletedRunCount = result.deletedRunCount;
        logger.info('Truncation succeeded', {
          targetEventId: targetId,
          deletedEventCount,
          deletedRunCount,
        });
      } else {
        logger.warn(`Truncation failed: message ${targetId} not found`);
      }
    }

    // 注意：我们不再在这里追加新事件
    // 新事件的追加将由 Runner 在执行完成后统一处理

    return {
      truncateHappened,
      deletedEventCount,
      deletedRunCount,
    };
  }

  /**
   * 读取 foreground Agent 的正文历史事件
   *
   * 功能 (What): 从 Repository 读取指定会话的历史事件
   *
   * 输入 (Input):
   * @param conversationId - 会话ID
   * @param fromRevision - 起始版本号，默认为 0
   *
   * 输出 (Output):
   * @returns Promise<RuntimeEvent[]> 历史事件数组
   *
   * 副作用 (Side-effects):
   * - 从数据库读取事件数据
   *
   * 实现细节:
   * - 调用 HistoryRepository.readForegroundFrom 方法
   * - 返回事件数组
   */
  async readHistory(conversationId: string, fromRevision: number = 0): Promise<RuntimeEvent[]> {
    const { events } = await this.historyAccessPort.readForegroundFrom(conversationId, fromRevision);
    logger.info(`Read history events: ${events.length} events from conversation ${conversationId}`);
    logger.debug('Event types:', events.map(e => `${e.type}:${e.id?.slice(0, 8)}`).join(', '));
    return events;
  }
}
