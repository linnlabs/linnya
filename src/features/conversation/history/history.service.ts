/**
 * @file src/features/conversation/history/history.service.ts
 * @description 对话历史管理业务逻辑层（Application Service Layer）
 *
 * 功能 (What):
 * 实现历史记录管理的业务逻辑，包括：
 * - 会话列表的查询和过滤
 * - 会话事件的分页读取
 * - 会话元数据的获取
 * - 会话标题的更新
 * - 会话的删除
 *
 * 输入 (Input):
 * - HistoryRepository 实例（通过构造函数注入）
 * - 各种业务请求参数
 *
 * 输出 (Output):
 * - 处理后的业务数据
 * - 操作结果（成功/失败）
 *
 * 副作用 (Side-effects):
 * - 通过 Repository 层间接操作数据库
 * - 可能抛出业务异常
 *
 * 设计原则:
 * - 单一职责：只负责业务逻辑，不直接操作数据库
 * - 依赖注入：依赖 Repository 抽象而非具体实现
 * - 错误处理：统一的错误处理和日志记录
 */

import { HistoryRepository } from './history.repository';
import type {
  ListConversationsQuery,
  ListConversationsResponse,
  ReadEventsQuery,
  ReadEventsResponse,
  ConversationMetadata,
} from './history.schemas';
import type {
  ConversationSubrunTraceResponse,
  SubrunTraceQuery,
  ConversationTurnIndexResponse,
  UiMessagesWindowResponse,
} from './ui-messages.schemas';
import type { RunFinalAnswerResult } from '../../../app-hosts/linnya/adapters/persistence/event-store/ui-projection/sqliteUiMessagesReader';
import { Logger } from '../../../shared/logger';
import { decodeConversationListCursor } from '../../../app-hosts/linnya/adapters/persistence/event-store/conversation-list-cursor';
import { RUNTIME_EVENT_TYPES_NEVER_REPLAYED_TO_UI } from '@linnlabs/linnkit/runtime-kernel/events';
import type { ConversationSelectedAgentId } from '@app/schemas';
import type { ConversationDeletionPort } from './definitions/conversationDeletionPort';
import type { ConversationCleanupStatusPort } from './definitions/conversationCleanupStatusPort';
import type { ConversationCleanupRetryOutcome } from '@app/schemas';

const logger = new Logger('HistoryService');

function normalizePositiveIntegerLimit(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(value), 1), max);
}

function normalizeCursor(value: number | undefined): number | undefined {
  if (!Number.isFinite(value) || value === undefined) {
    return undefined;
  }

  return Math.trunc(value);
}

function normalizeConversationListCursor(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return decodeConversationListCursor(value) ? value : undefined;
}

function normalizeReadDirection(value: ReadEventsQuery['direction']): 'forward' | 'backward' {
  return value === 'forward' ? 'forward' : 'backward';
}

/**
 * 历史记录服务类
 *
 * 功能 (What): 提供历史记录管理的业务逻辑接口
 */
export class HistoryService {
  /**
   * 构造函数
   *
   * 功能 (What): 初始化服务，注入 Repository 依赖
   *
   * @param repository - 历史记录仓库实例
   */
  constructor(
    private readonly repository: HistoryRepository,
    private readonly deletion: ConversationDeletionPort,
    private readonly cleanupStatus: ConversationCleanupStatusPort,
  ) {}

  /**
   * 获取会话列表
   *
   * 功能 (What): 获取分页的会话列表，支持搜索功能
   *
   * 输入 (Input):
   * @param query - 查询参数
   *   - limit: 每页数量，默认 30，最大 100
   *   - cursor: opaque string keyset 游标
   *   - search: 搜索关键词（可选）
   *
   * 输出 (Output):
   * @returns Promise<ListConversationsResponse> 会话列表响应，包含分页信息
   *
   * 副作用 (Side-effects):
   * - 通过 Repository 读取数据库
   * - 记录日志信息
   */
  async listConversations(query: ListConversationsQuery): Promise<ListConversationsResponse> {
    logger.info('Listing conversations', { query });

    try {
      // 参数验证和归一化
      const normalizedQuery: ListConversationsQuery = {
        limit: normalizePositiveIntegerLimit(query.limit, 30, 100),
        cursor: normalizeConversationListCursor(query.cursor),
        search: query.search?.trim() || undefined,
        // undefined 表示 Linnya 助手的无项目会话列表。
        projectId: query.projectId?.trim() || undefined,
      };

      // 调用 Repository 获取数据
      const result = await this.repository.listConversations(normalizedQuery);
      const pendingCleanupIds = await this.cleanupStatus.readPendingConversationIds(
        result.conversations.map(conversation => conversation.conversation_id),
      );
      const projectedResult: ListConversationsResponse = {
        ...result,
        conversations: result.conversations.map(conversation => (
          pendingCleanupIds.has(conversation.conversation_id)
            ? { ...conversation, cleanup_pending: true }
            : conversation
        )),
      };

      logger.info('Conversations listed successfully', {
        count: projectedResult.conversations.length,
        hasMore: projectedResult.has_more,
      });

      return projectedResult;
    } catch (error) {
      logger.error('Failed to list conversations', error);
      throw error;
    }
  }

  /**
   * 读取会话事件
   *
   * 功能 (What): 获取指定会话的事件历史，支持分页和方向控制
   *
   * 输入 (Input):
   * @param conversationId - 会话ID
   * @param query - 查询参数
   *   - limit: 每页数量，默认 50，最大 200
   *   - cursor: 游标（事件序号）
   *   - direction: 分页方向，'forward' 或 'backward'
   *
   * 输出 (Output):
   * @returns Promise<ReadEventsResponse> 事件列表响应，包含分页信息
   *
   * 副作用 (Side-effects):
   * - 通过 Repository 读取数据库
   * - 记录日志信息
   *
   * @throws Error 如果 conversationId 为空
   */
  async readConversationEvents(
    conversationId: string,
    query: ReadEventsQuery
  ): Promise<ReadEventsResponse> {
    // 参数验证
    if (!conversationId || conversationId.trim().length === 0) {
      throw new Error('conversationId is required');
    }

    try {
      // 参数验证和归一化
      const normalizedQuery: ReadEventsQuery = {
        limit: normalizePositiveIntegerLimit(query.limit, 50, 200),
        cursor: normalizeCursor(query.cursor),
        direction: normalizeReadDirection(query.direction),
        excludeTypes: RUNTIME_EVENT_TYPES_NEVER_REPLAYED_TO_UI,
      };

      // 调用 Repository 获取数据
      const result = await this.repository.readEvents(conversationId, normalizedQuery);

      return result;
    } catch (error) {
      logger.error('Failed to read conversation events', { conversationId, error });
      throw error;
    }
  }

  async readUiMessagesTail(conversationId: string, limit: number): Promise<UiMessagesWindowResponse> {
    assertConversationId(conversationId);
    return this.repository.readUiMessagesTail(conversationId, limit);
  }

  async readUiMessagesBefore(
    conversationId: string,
    cursor: number,
    limit: number,
  ): Promise<UiMessagesWindowResponse> {
    assertConversationId(conversationId);
    return this.repository.readUiMessagesBefore(conversationId, cursor, limit);
  }

  async readUiMessagesAfter(
    conversationId: string,
    cursor: number,
    limit: number,
  ): Promise<UiMessagesWindowResponse> {
    assertConversationId(conversationId);
    return this.repository.readUiMessagesAfter(conversationId, cursor, limit);
  }

  async readUiMessagesAround(
    conversationId: string,
    anchorMessageId: string,
    limit: number,
  ): Promise<UiMessagesWindowResponse> {
    assertConversationId(conversationId);
    return this.repository.readUiMessagesAround(conversationId, anchorMessageId, limit);
  }

  async readRunFinalAnswer(
    conversationId: string,
    runId: string,
  ): Promise<RunFinalAnswerResult> {
    assertConversationId(conversationId);
    if (runId.trim().length === 0) {
      throw new Error('runId is required');
    }
    return this.repository.readRunFinalAnswer(conversationId, runId);
  }

  async readTurnIndex(conversationId: string): Promise<ConversationTurnIndexResponse> {
    assertConversationId(conversationId);
    return this.repository.readTurnIndex(conversationId);
  }

  async readSubrunTrace(
    conversationId: string,
    parentToolCallId: string,
    subrunId: string,
    options: Pick<SubrunTraceQuery, 'kinds' | 'limit' | 'cursor'>,
  ): Promise<ConversationSubrunTraceResponse> {
    assertConversationId(conversationId);
    return this.repository.readSubrunTrace(conversationId, parentToolCallId, subrunId, options);
  }

  /**
   * 获取会话元数据
   *
   * 功能 (What): 获取指定会话的元数据信息
   *
   * 输入 (Input):
   * @param conversationId - 会话ID
   *
   * 输出 (Output):
   * @returns Promise<ConversationMetadata | null> 会话元数据，如果不存在返回 null
   *
   * 副作用 (Side-effects):
   * - 通过 Repository 读取数据库
   * - 记录日志信息
   *
   * @throws Error 如果 conversationId 为空
   */
  async getConversationMetadata(conversationId: string): Promise<ConversationMetadata | null> {
    // 参数验证
    if (!conversationId || conversationId.trim().length === 0) {
      throw new Error('conversationId is required');
    }

    logger.info('Getting conversation metadata', { conversationId });

    try {
      // 调用 Repository 获取数据
      const metadata = await this.repository.getMetadata(conversationId);

      if (metadata) {
        logger.info('Metadata retrieved successfully', { conversationId });
      } else {
        logger.warn('Conversation not found', { conversationId });
      }

      return metadata;
    } catch (error) {
      logger.error('Failed to get conversation metadata', { conversationId, error });
      throw error;
    }
  }

  /**
   * 更新会话标题
   *
   * 功能 (What): 修改指定会话的标题
   *
   * 输入 (Input):
   * @param conversationId - 会话ID
   * @param title - 新标题（将被 trim 处理）
   *
   * 输出 (Output):
   * @returns Promise<boolean> 更新是否成功
   *
   * 副作用 (Side-effects):
   * - 通过 Repository 更新数据库
   * - 记录日志信息
   *
   * @throws Error 如果 conversationId 为空或 title 为空
   */
  async updateConversationTitle(conversationId: string, title: string): Promise<boolean> {
    // 参数验证
    if (!conversationId || conversationId.trim().length === 0) {
      throw new Error('conversationId is required');
    }

    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      throw new Error('title cannot be empty');
    }

    logger.info('Updating conversation title', { conversationId, title: trimmedTitle });

    try {
      // 调用 Repository 更新数据
      const success = await this.repository.updateTitle(conversationId, trimmedTitle);

      if (success) {
        logger.info('Title updated successfully', { conversationId });
      } else {
        logger.warn('Failed to update title - conversation not found', { conversationId });
      }

      return success;
    } catch (error) {
      logger.error('Failed to update conversation title', { conversationId, error });
      throw error;
    }
  }

  /**
   * 更新会话置顶状态。
   *
   * 中文备注：
   * - 置顶影响历史列表排序，是用户可感知的持久化偏好；
   * - 取消置顶时清空 pinned_at，避免旧时间戳在后续排序里产生歧义。
   */
  async updateConversationPinned(
    conversationId: string,
    pinned: boolean,
  ): Promise<{ success: boolean; isPinned: boolean; pinnedAt?: number }> {
    if (!conversationId || conversationId.trim().length === 0) {
      throw new Error('conversationId is required');
    }

    const pinnedAt = pinned ? Date.now() : null;

    logger.info('Updating conversation pinned state', { conversationId, pinned, pinnedAt });

    try {
      const success = await this.repository.updatePinned(conversationId, pinned, pinnedAt);

      if (success) {
        logger.info('Pinned state updated successfully', { conversationId, pinned });
      } else {
        logger.warn('Failed to update pinned state - conversation not found', { conversationId });
      }

      return {
        success,
        isPinned: pinned,
        ...(typeof pinnedAt === 'number' ? { pinnedAt } : {}),
      };
    } catch (error) {
      logger.error('Failed to update conversation pinned state', { conversationId, error });
      throw error;
    }
  }

  async updateConversationSelectedAgent(
    conversationId: string,
    selectedAgentId: ConversationSelectedAgentId | null,
    projectId: string | null,
  ): Promise<boolean> {
    if (!conversationId || conversationId.trim().length === 0) {
      throw new Error('conversationId is required');
    }

    return this.repository.updateSelectedAgent(conversationId, selectedAgentId, projectId);
  }

  /**
   * 删除会话
   *
   * 功能 (What): 删除指定的会话及其所有事件
   *
   * 输入 (Input):
   * @param conversationId - 会话ID
   *
   * 输出 (Output):
   * @returns Promise<boolean> 删除是否成功
   *
   * 副作用 (Side-effects):
   * - 通过 App 级生命周期工作流停止活动并删除目录、批准和对话事实（不可逆操作）
   * - 记录日志信息
   *
   * @throws Error 如果 conversationId 为空
   */
  async deleteConversation(conversationId: string): Promise<boolean> {
    // 参数验证
    if (!conversationId || conversationId.trim().length === 0) {
      throw new Error('conversationId is required');
    }

    logger.info('Deleting conversation', { conversationId });

    try {
      const success = await this.deletion.requestDeletion(conversationId);

      if (success) {
        logger.info('Conversation deleted successfully', { conversationId });
      } else {
        logger.warn('Failed to delete conversation - not found', { conversationId });
      }

      return success;
    } catch (error) {
      logger.error('Failed to delete conversation', { conversationId, error });
      throw error;
    }
  }

  async retryPendingCleanup(conversationId: string): Promise<ConversationCleanupRetryOutcome> {
    if (!conversationId || conversationId.trim().length === 0) {
      throw new Error('conversationId is required');
    }
    return this.cleanupStatus.retryPending(conversationId);
  }
}

function assertConversationId(conversationId: string): void {
  if (!conversationId || conversationId.trim().length === 0) {
    throw new Error('conversationId is required');
  }
}
