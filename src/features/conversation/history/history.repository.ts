/**
 * @file src/features/conversation/history/history.repository.ts
 * @description 对话历史数据访问层（Repository Layer）
 *
 * 功能 (What):
 * 作为数据访问层，封装与 EventStore 的所有交互逻辑。
 * 提供类型安全的数据访问接口，隔离底层存储实现细节。
 *
 * 输入 (Input):
 * - EventStore 实例（通过构造函数注入）
 * - 各种查询参数（会话ID、分页参数、搜索关键词等）
 *
 * 输出 (Output):
 * - 类型安全的会话列表、事件列表、元数据等
 * - 布尔值表示操作成功或失败
 *
 * 副作用 (Side-effects):
 * - 读取和修改数据库中的会话数据
 * - 通过 EventStore 进行事件溯源操作
 *
 * 设计原则:
 * - 单一职责：只负责数据访问，不包含业务逻辑
 * - 依赖倒置：依赖 EventStore 接口而非具体实现
 * - 类型安全：使用严格的类型系统避免运行时错误
 */

import type {
  AppendEventToRunOptions,
  IEventStore,
  ReplaceUserInputEventOptions,
  ReplaceUserInputEventResult,
  RunMetadata,
  RunSession,
  RuntimeEventReadRoutingScope,
  TruncateHistoryFromEventResult,
} from '../../../app-hosts/linnya/adapters/persistence/event-store';
import type {
  ConversationTurnIndexResult,
  SubrunTraceReadOptions,
  SubrunTraceResult,
  UiMessagesWindowResult,
  RunFinalAnswerResult,
} from '../../../app-hosts/linnya/adapters/persistence/event-store/ui-projection/sqliteUiMessagesReader';
import type {
  ListConversationsQuery,
  ListConversationsResponse,
  ReadEventsQuery,
  ReadEventsResponse,
  ConversationMetadata,
} from './history.schemas';
import type { RoutedRuntimeEvent, RuntimeEvent } from 'linnkit/contracts';
import type { ConversationSelectedAgentId } from '@app/schemas';

export interface UiMessagesReadRepository {
  readTail(conversationId: string, limit: number): UiMessagesWindowResult;
  readBefore(conversationId: string, cursor: number, limit: number): UiMessagesWindowResult;
  readAfter(conversationId: string, cursor: number, limit: number): UiMessagesWindowResult;
  readAround(conversationId: string, anchorMessageId: string, limit: number): UiMessagesWindowResult;
  readRunFinalAnswer(conversationId: string, runId: string): RunFinalAnswerResult;
  readTurnIndex(conversationId: string): ConversationTurnIndexResult;
  readSubrunTrace(
    conversationId: string,
    parentToolCallId: string,
    subrunId: string,
    options?: SubrunTraceReadOptions,
  ): SubrunTraceResult;
}

/**
 * 历史记录仓库类
 *
 * 功能 (What): 封装所有与历史记录相关的数据库操作
 */
export class HistoryRepository {
  /**
   * 构造函数
   *
   * 功能 (What): 初始化仓库，注入 EventStore 依赖
   *
   * @param eventStore - 事件存储实例
   */
  constructor(
    private readonly eventStore: IEventStore,
    private readonly uiMessagesReader?: UiMessagesReadRepository,
  ) {}

  /**
   * 🔥 新增：确保会话存在
   */
  async ensureConversation(
    conversationId: string,
    initialEvents: RuntimeEvent[],
    projectId?: string,
    mode?: string,
  ): Promise<void> {
    await this.eventStore.ensureConversation(conversationId, initialEvents, projectId, mode);
  }

  /**
   * 列出会话
   *
   * 功能 (What): 获取分页的会话列表，支持搜索和游标分页
   *
   * 输入 (Input):
   * @param query - 查询参数对象
   *   - limit: 每页数量，默认 30
   *   - cursor: opaque string keyset 游标
   *   - search: 搜索关键词
   *
   * 输出 (Output):
   * @returns Promise<ListConversationsResponse> 包含会话列表和分页信息
   *
   * 副作用 (Side-effects):
   * - 从数据库读取会话元数据
   */
  async listConversations(query: ListConversationsQuery): Promise<ListConversationsResponse> {
    // 直接调用 EventStore 的方法
    const result = await this.eventStore.listConversations(query);

    // 适配旧的 ListItem 格式
    const adaptedConversations = result.conversations.map(c => ({
      conversation_id: c.conversation_id,
      title: c.title,
      created_at: c.created_at,
      last_event_at: c.last_event_at,
      event_count: c.total_events,
      preview_text: c.preview_text, // 🔥 新增：返回预览文本
      user_message_count: c.user_message_count, // 🔥 新增：返回用户消息数量
      project_id: c.project_id ?? null,
      is_pinned: c.is_pinned,
      pinned_at: c.pinned_at,
      selected_agent_id: c.selected_agent_id,
    }));

    return {
      conversations: adaptedConversations,
      next_cursor: result.nextCursor,
      has_more: result.hasMore,
    };
  }

  /**
   * 根据会话ID获取事件列表
   *
   * 功能 (What): 获取指定会话的事件历史，支持分页和方向控制
   *
   * 输入 (Input):
   * @param conversationId - 会话的唯一标识符
   * @param query - 查询参数对象
   *   - limit: 每页数量，默认 50
   *   - cursor: 游标（事件序号或ID）
   *   - direction: 分页方向，'forward'（旧到新）或 'backward'（新到旧）
   *
   * 输出 (Output):
   * @returns Promise<ReadEventsResponse> 包含事件列表和分页信息
   *
   * 副作用 (Side-effects):
   * - 从数据库读取事件数据
   */
  async readEvents(
    conversationId: string,
    query: ReadEventsQuery
  ): Promise<ReadEventsResponse> {
    try {
      /**
       * 历史审计与 Runtime replay 必须读取事实表，不能用 UI read model 反推原始事件。
       * 这里直接返回 EventStore 的 RuntimeEvent 分页，不混入任何产品工具状态恢复。
       */
      const result = await this.eventStore.readEvents(conversationId, query);

      return {
        events: result.events,
        next_cursor: result.nextCursor,
        has_more: result.hasMore,
        // revision 在新模型中不再是顶层概念，暂时用 event count 模拟
        revision: result.events.length,
      };
    } catch (error) {
      console.error(`[HistoryRepository] Error reading events for ${conversationId}:`, error);
      throw error;
    }
  }

  async readUiMessagesTail(conversationId: string, limit: number): Promise<UiMessagesWindowResult> {
    return this.requireUiMessagesReader().readTail(conversationId, limit);
  }

  async readUiMessagesBefore(
    conversationId: string,
    cursor: number,
    limit: number,
  ): Promise<UiMessagesWindowResult> {
    return this.requireUiMessagesReader().readBefore(conversationId, cursor, limit);
  }

  async readUiMessagesAfter(
    conversationId: string,
    cursor: number,
    limit: number,
  ): Promise<UiMessagesWindowResult> {
    return this.requireUiMessagesReader().readAfter(conversationId, cursor, limit);
  }

  async readUiMessagesAround(
    conversationId: string,
    anchorMessageId: string,
    limit: number,
  ): Promise<UiMessagesWindowResult> {
    return this.requireUiMessagesReader().readAround(conversationId, anchorMessageId, limit);
  }

  async readRunFinalAnswer(
    conversationId: string,
    runId: string,
  ): Promise<RunFinalAnswerResult> {
    return this.requireUiMessagesReader().readRunFinalAnswer(conversationId, runId);
  }

  async readTurnIndex(conversationId: string): Promise<ConversationTurnIndexResult> {
    return this.requireUiMessagesReader().readTurnIndex(conversationId);
  }

  async readSubrunTrace(
    conversationId: string,
    parentToolCallId: string,
    subrunId: string,
    options?: SubrunTraceReadOptions,
  ): Promise<SubrunTraceResult> {
    return this.requireUiMessagesReader().readSubrunTrace(
      conversationId,
      parentToolCallId,
      subrunId,
      options,
    );
  }

  /**
   * 获取会话元数据
   *
   * 功能 (What): 获取指定会话的元数据信息（标题、创建时间、事件数等）
   *
   * 输入 (Input):
   * @param conversationId - 会话的唯一标识符
   *
   * 输出 (Output):
   * @returns Promise<ConversationMetadata | null> 会话元数据，如果会话不存在则返回 null
   *
   * 副作用 (Side-effects):
   * - 从数据库读取会话元数据
   */
  async getMetadata(conversationId: string): Promise<ConversationMetadata | null> {
    // ✅ 使用新的 getConversationMetadata 方法直接查询
    const target = await this.eventStore.getConversationMetadata(conversationId);

    if (!target) {
      return null;
    }

    return {
      conversation_id: target.conversation_id,
      title: target.title,
      created_at: target.created_at,
      last_event_at: target.last_event_at,
      event_count: target.total_events,
      preview_text: target.preview_text,
      user_message_count: target.user_message_count,
      current_revision: target.total_events, // 使用 total_events 作为 revision 的近似值
      project_id: target.project_id ?? null,
      is_pinned: target.is_pinned,
      pinned_at: target.pinned_at,
      mode: target.mode, // 🔥 新增：将底层 EventStore 中的会话模式暴露给上层
      selected_agent_id: target.selected_agent_id,
    };
  }

  /**
   * 更新会话标题
   *
   * 功能 (What): 修改指定会话的标题
   *
   * 输入 (Input):
   * @param conversationId - 会话的唯一标识符
   * @param title - 新的标题文本
   *
   * 输出 (Output):
   * @returns Promise<boolean> 操作是否成功，true 表示成功，false 表示会话不存在或更新失败
   *
   * 副作用 (Side-effects):
   * - 更新数据库中的会话标题
   */
  async updateTitle(conversationId: string, title: string): Promise<boolean> {
    // 直接调用 EventStore 的方法
    return this.eventStore.updateTitle(conversationId, title);
  }

  /**
   * 更新会话置顶状态。
   *
   * 中文备注：置顶属于历史列表的排序规则，Repository 只透传持久化动作，
   * 具体时间戳和校验留在 Service 层，避免数据访问层夹带业务流程。
   */
  async updatePinned(conversationId: string, pinned: boolean, pinnedAt: number | null): Promise<boolean> {
    return this.eventStore.updatePinned(conversationId, pinned, pinnedAt);
  }

  async updateSelectedAgent(
    conversationId: string,
    selectedAgentId: ConversationSelectedAgentId | null,
    projectId: string | null,
  ): Promise<boolean> {
    return this.eventStore.updateSelectedAgent(conversationId, selectedAgentId, projectId);
  }

  /**
   * 从目标事实事件所属 run 开始截断历史。
   *
   * 中文说明：该方法是 inclusive run 语义，会删除目标事件所属 run 及后续 run。
   * @param conversationId 对话ID
   * @param eventId 用于定位目标 run 的事实事件 ID
   */
  async truncateFromEvent(
    conversationId: string,
    eventId: string
  ): Promise<TruncateHistoryFromEventResult> {
    return this.eventStore.truncateFromEvent(conversationId, eventId);
  }

  async beginRunSession(conversationId: string, runId: string, metadata: RunMetadata): Promise<RunSession> {
    return this.eventStore.beginRunSession(conversationId, runId, metadata);
  }

  async openRunSession(conversationId: string, runId: string): Promise<RunSession> {
    return this.eventStore.openRunSession(conversationId, runId);
  }

  async appendEventToRun(
    session: RunSession,
    event: RoutedRuntimeEvent,
    options?: AppendEventToRunOptions,
  ): Promise<void> {
    await this.eventStore.appendEventToRun(session, event, options);
  }

  async replaceUserInputEvent(
    session: RunSession,
    targetEventId: string,
    replacement: RoutedRuntimeEvent,
    options?: ReplaceUserInputEventOptions,
  ): Promise<ReplaceUserInputEventResult> {
    return this.eventStore.replaceUserInputEvent(session, targetEventId, replacement, options);
  }

  async completeRun(session: RunSession): Promise<void> {
    await this.eventStore.completeRun(session);
  }

  async failRun(session: RunSession, error: { code: string; message: string }): Promise<void> {
    await this.eventStore.failRun(session, error);
  }

  private requireUiMessagesReader(): UiMessagesReadRepository {
    if (!this.uiMessagesReader) {
      throw new Error('ui messages reader is not configured');
    }
    return this.uiMessagesReader;
  }

  /**
   * 读取会话的“事实事件历史”（RuntimeEvent）。
   *
   * 中文备注：
   * - 这是回放/状态重建的基础能力；
   * - 不应依赖 messages 物化视图（否则某些“非主时间轴的边界事件/工具事实”可能丢失）。
   */
  async readFrom(
    conversationId: string,
    fromRevision: number = 0,
  ): Promise<{ events: RuntimeEvent[]; revision: number }> {
    return this.readFromWithRoutingScope(conversationId, fromRevision);
  }

  /** 为前台 Agent 读取正文上下文；child/auxiliary facts 仍保留在默认事实读取中。 */
  async readForegroundFrom(
    conversationId: string,
    fromRevision: number = 0,
  ): Promise<{ events: RuntimeEvent[]; revision: number }> {
    return this.readFromWithRoutingScope(
      conversationId,
      fromRevision,
      'foreground-conversation',
    );
  }

  private async readFromWithRoutingScope(
    conversationId: string,
    fromRevision: number,
    routingScope?: RuntimeEventReadRoutingScope,
  ): Promise<{ events: RuntimeEvent[]; revision: number }> {
    /**
     * ✅ 根因级修复：必须读取“完整事实事件历史”，而不是只读固定数量的旧事件
     *
     * 背景（对应你看到的 deep_research 看板“到某一步突然变空”）：
     * - 旧实现：`direction='forward' + limit=1000` 只会拿到“最早的 1000 条事件”；
     * - deep_research 每步会产生大量事件，一旦总事件数 > 1000：
     *   - 上层编排读取不到最新的“共享状态快照”；
     *   - 误判“尚未产生快照”，从而写入一条“初始化空快照”；
     *   - 这条空快照时间戳更晚，会覆盖为“最新快照”，导致后续读取看到空白。
     *
     * 结论：
     * - 这里必须分页读取全部 events，保持回放与状态重建的确定性；
     * - fromRevision 语义依赖“全量事件序列”，因此不能用“只读最后 N 条”的窗口替代。
     */
    // 中文备注：这里的 pageSize 不追求极大，关键是“可分页读全”，避免一次性读爆内存。
    const pageSize = 500;
    let cursor: number | undefined = undefined;
    const allEvents: RuntimeEvent[] = [];

    // 注意：EventStore.readEvents 的 forward/backward 都会返回“旧→新”的时间正序，这里直接累加即可。
    while (true) {
      const page = await this.eventStore.readEvents(conversationId, {
        limit: pageSize,
        direction: 'forward',
        ...(routingScope ? { routingScope } : {}),
        ...(typeof cursor === 'number' ? { cursor } : {}),
      });

      allEvents.push(...page.events);

      if (page.hasMore !== true) break;
      if (typeof page.nextCursor !== 'number') {
        // 这是存储层契约破坏：has_more=true 但缺游标，无法继续分页
        throw new Error('[HistoryRepository.readFrom] has_more=true but next_cursor is missing');
      }
      cursor = page.nextCursor;
    }

    const events = allEvents.slice(fromRevision);
    return { events, revision: allEvents.length };
  }
}
