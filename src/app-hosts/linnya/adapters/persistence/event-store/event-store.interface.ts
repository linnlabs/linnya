import type { RoutedRuntimeEvent, RuntimeEvent } from 'linnkit/contracts';
import type { WorkspaceAssetCommitRecord } from 'src/features/workspace/assets/definitions/workspaceAssetCommit';
import type { ConversationRunKind } from '../definitions/conversationRunKind';
import type { ConversationSelectedAgentId } from '@app/schemas';

// --- 类型定义 ---

/**
 * 单次 run 的持久化元数据。
 *
 * 中文备注：
 * - 该结构是 EventStore 写入接口的一部分，语义上属于 persistence core 协议；
 * - 不应继续定义在 Flow 领域里，否则会形成 core -> features 的反向类型依赖。
 */
export interface RunMetadata {
  /** 使用 persistence domain 的共享协议，禁止 EventStore 与 RunRegistry 各自扩展值域。 */
  kind: ConversationRunKind;
  model_key?: string;
  toolset_version?: string;
}

/**
 * B3a.5 写入会话 token。
 *
 * 中文备注：
 * - caller 只能通过 beginRunSession() 获取，不应自己构造；
 * - 每个公开写入方法各自持有一次短事务，不跨 LLM/tool 执行过程持有数据库事务。
 */
export interface RunSession {
  readonly runId: string;
  readonly conversationId: string;
  readonly startedAt: number;
}

export interface AppendEventToRunOptions {
  /**
   * linnkit EventStore cursor id.
   *
   * 中文备注：
   * - 仅 PR-C 的 LinnyaEventStoreAdapter 传入；
   * - host 主写链不传，events.event_store_id 保持 NULL；
   * - adapter 写入与 host 主写链必须共享同一个 run 生命周期，禁止在 EventStore 里临时补 run。
   */
  readonly eventStoreId?: string;
  /**
   * 当前 event 首次引用且尚未进入 assets 的受管资源。
   * 记录必须与 event.attachments 的 canonical resourceId 对齐，并在同一短事务登记。
   */
  readonly assetCommits?: readonly WorkspaceAssetCommitRecord[];
}

export interface ReplaceUserInputEventOptions {
  /** 当前替换事件首次登记的受管资源，必须与 event.attachments 对齐。 */
  readonly assetCommits?: readonly WorkspaceAssetCommitRecord[];
}

export interface ReplaceUserInputEventResult {
  readonly deletedEventCount: number;
  readonly deletedRunCount: number;
}

export interface TruncateHistoryFromEventResult {
  readonly found: boolean;
  readonly deletedEventCount: number;
  readonly deletedRunCount: number;
}

export type RuntimeEventReadRoutingScope = 'foreground-conversation';

export interface ReadRuntimeEventsOptions {
  limit?: number;
  cursor?: number;
  direction?: 'forward' | 'backward';
  excludeTypes?: readonly string[];
  /** 仅为指定消费链过滤 routing identity；所有读取均要求事实已携带正式身份。 */
  routingScope?: RuntimeEventReadRoutingScope;
}

// 用于 listConversations 的返回类型
export interface ConversationListItem {
  conversation_id: string;
  title: string;
  created_at: number;
  last_event_at: number;
  preview_text?: string;
  total_events: number;
  user_message_count: number;
  project_id?: string | null;
  is_pinned: boolean;
  pinned_at?: number;
  mode?: string;
  selected_agent_id: ConversationSelectedAgentId | null;
}

// --- 接口定义 ---

export interface IEventStore {
  /**
   * 创建一次显式 run 写入会话。
   *
   * 事务契约：一次短事务。INSERT 一行 runs(status='running') 后立即 commit。
   * runId 必须由调用方传入，禁止存储层自行生成 host runId。
   * 注意：不负责 ensureConversation；caller 必须先确保 conversation 已存在。
   */
  beginRunSession(conversationId: string, runId: string, metadata: RunMetadata): Promise<RunSession>;

  /**
   * 打开已存在 run 的写入会话。
   *
   * 中文备注：
   * - root agent/chat run 必须先由 linnkit RunSupervisor 注册；
   * - 这里只校验父 run 已存在且归属同一 conversation，然后返回写入 token。
   */
  openRunSession(conversationId: string, runId: string): Promise<RunSession>;

  /**
   * 追加单条事件到当前写入会话。
   *
   * 事务契约：每条事件一次短事务。
   * 成功时写入 events、资源关联与 conversation_ui_messages，并增量更新 conversations 统计。
   * opts.eventStoreId 仅用于 B3b adapter 路径写入 events.event_store_id；
   * opts.assetCommits 与 event link、projection、stats 在同一事务提交。
   * 会话附件不代表项目资源库成员；只有显式资源库流程才能写 project_asset_links。
   * 失败时本条事件不写入；之前已经 commit 的事件不回滚。
   */
  appendEventToRun(session: RunSession, event: RoutedRuntimeEvent, opts?: AppendEventToRunOptions): Promise<void>;

  /**
   * 原子替换一个 user_input 事实及其后续 run 历史。
   *
   * 中文说明：
   * - targetEventId 必须属于 session.conversationId，且必须是 user_input；
   * - replacement 必须继续使用同一个稳定消息 ID；
   * - inclusive truncate、新 event、asset/link、UI projection 与统计在同一事务提交；
   * - destination run 必须已存在，并且绝不能被本次 truncate 删除。
   */
  replaceUserInputEvent(
    session: RunSession,
    targetEventId: string,
    replacement: RoutedRuntimeEvent,
    opts?: ReplaceUserInputEventOptions,
  ): Promise<ReplaceUserInputEventResult>;

  /**
   * 标记 run 完成。
   *
   * 事务契约：一次短事务。UPDATE runs.status='completed' 后立即 commit。
   */
  completeRun(session: RunSession): Promise<void>;

  /**
   * 标记 run 失败。
   *
   * 事务契约：一次短事务。已写入的 events/read model 不删除。
   * error 仅用于日志，B3 第一版不新增 run.error schema。
   */
  failRun(session: RunSession, error: { code: string; message: string }): Promise<void>;

  /**
   * 🔥 新增：确保会话存在，如果不存在则创建
   * @param conversationId - 对话ID
   * @param initialEvents - 用于提取标题和预览的初始事件
   * @returns Promise<void>
   */
  ensureConversation(conversationId: string, initialEvents: RuntimeEvent[], projectId?: string, mode?: string): Promise<void>;

  /**
   * 读取原始 RuntimeEvent（从 events 事实表读取）
   *
   * 设计说明：
   * - 返回已经通过 stored-fact 身份校验的事实事件，用于精确回放、审计与状态重建；
   * - 默认不做 routing 过滤；foreground context 必须显式请求 foreground-conversation scope；
   * - payload 与 events/runs 关系列必须一致，缺 routing 或归属不一致时直接失败；
   * - 分页游标使用 SQLite 的 rowid（整数、单调递增），确保稳定分页且不会因为 ts 相同而漏事件；
   * - 无论 forward/backward，都返回持久化顺序正序（旧→新）。
   */
  readEvents(
    conversationId: string,
    options?: ReadRuntimeEventsOptions,
  ): Promise<{
    events: RoutedRuntimeEvent[];
    nextCursor?: number;
    hasMore: boolean;
  }>;

  /**
   * 列出所有对话（用于历史列表）
   *
   * 中文说明：
   * - 列表 cursor 是 opaque string，调用方只能原样传回；
   * - 内部包含排序位置和 conversation_id tie-breaker，用于避免同毫秒 / 同置顶时间跨页漏项。
   *
   * @param options 分页和搜索选项
   * @returns 对话列表和分页信息
   */
  listConversations(
    options?: {
      limit?: number;
      cursor?: string;
      search?: string;
      // 不传时查询 Linnya 助手的无项目会话。
      projectId?: string;
    }
  ): Promise<{
    conversations: ConversationListItem[];
    nextCursor?: string;
    hasMore: boolean;
  }>;

  /**
   * 删除所有不属于任何项目的会话（project_id IS NULL）。
   *
   * 兼容说明：
   * - `project_id IS NULL` 现归属于 Linnya 助手；
   * - 该方法只供显式迁移/调试，不应在启动维护中调用。
   *
   * @returns 删除的会话数量
   */
  deleteConversationsWithoutProject(): Promise<number>;

  /**
   * 获取单个会话的元数据
   * @param conversationId 对话ID
   * @returns 会话元数据，如果不存在返回 null
   */
  getConversationMetadata(conversationId: string): Promise<ConversationListItem | null>;
  
  /**
   * 更新对话标题
   */
  updateTitle(conversationId: string, title: string): Promise<boolean>;

  /**
   * 更新对话置顶状态。
   *
   * 中文备注：
   * - 置顶是历史列表的持久化排序语义，不能只放在前端内存里；
   * - pinnedAt 由调用层传入，便于测试和未来审计统一时间源。
   */
  updatePinned(conversationId: string, pinned: boolean, pinnedAt: number | null): Promise<boolean>;

  /** 原子正式化会话并持久化 Agent 产品身份；已有会话不改写项目归属。 */
  updateSelectedAgent(
    conversationId: string,
    selectedAgentId: ConversationSelectedAgentId | null,
    projectId: string | null,
  ): Promise<boolean>;

  /**
   * 删除对话及其 runs、events、资源关联和 UI read model。
   */
  deleteConversation(conversationId: string): Promise<boolean>;

  /**
   * 从目标 message/event 开始截断：删除目标及其之后的消息、事件和轮次。
   *
   * 中文说明：
   * - 这是编辑重发路径需要的 inclusive 语义；
   * - 目标事件必须被删除，否则重发时复用 event.id 会撞唯一约束。
   */
  truncateFromEvent(
    conversationId: string,
    eventId: string
  ): Promise<TruncateHistoryFromEventResult>;
  
  /**
   * 关闭数据库连接
   */
  close(): void;
}
