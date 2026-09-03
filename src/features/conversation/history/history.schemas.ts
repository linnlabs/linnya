import type { RuntimeEvent } from 'linnkit/contracts';
import type {
  ConversationHistoryListItem,
  ConversationHistoryMetadata,
} from '@app/schemas';

/**
 * 会话列表查询参数
 *
 * 功能 (What): 定义获取会话列表时的查询条件
 *
 * @property limit - 每页返回的会话数量，默认 30
 * @property cursor - opaque string 游标，用于分页；后端返回的 next_cursor 原样传回
 * @property search - 搜索关键词，可选，用于过滤会话标题
 * @property projectId - 项目 ID；不传时查询 Linnya 助手的无项目会话
 */
export interface ListConversationsQuery {
  limit?: number;
  cursor?: string;
  search?: string;
  projectId?: string;
}

/**
 * 会话列表项
 *
 * 功能 (What): 定义会话列表中单个会话的基本信息
 *
 * @property conversation_id - 会话的唯一标识符
 * @property title - 会话标题，通常是第一条用户输入的前 50 个字符
 * @property created_at - 会话创建时间戳（毫秒）
 * @property last_event_at - 最后一次事件发生的时间戳（毫秒），用于排序
 * @property event_count - 该会话中的事件总数
 * @property user_message_count - 用户消息的数量（用于统计对话条数）
 * @property project_id - 会话所属项目 ID；为空表示 Linnya 助手无项目会话
 * @property is_pinned - 是否置顶
 * @property pinned_at - 置顶时间戳，未置顶时为空
 */
export type ConversationListItem = ConversationHistoryListItem;

/**
 * 会话列表响应
 *
 * 功能 (What): 定义 API 返回的会话列表结构
 *
 * @property conversations - 会话列表数组
 * @property next_cursor - 下一页 opaque string 游标，如果没有更多数据则为 undefined
 * @property has_more - 是否还有更多数据
 */
export interface ListConversationsResponse {
  conversations: ConversationListItem[];
  next_cursor?: string;
  has_more: boolean;
}

/**
 * 会话元数据
 *
 * 功能 (What): 定义单个会话的完整元数据
 *
 * @property conversation_id - 会话的唯一标识符
 * @property title - 会话标题
 * @property created_at - 会话创建时间戳（毫秒）
 * @property last_event_at - 最后一次事件发生的时间戳（毫秒）
 * @property event_count - 该会话中的事件总数
 * @property current_revision - 当前的版本号（EventStore 的 revision）
 * @property project_id - 会话所属项目 ID；为空表示 Linnya 助手无项目会话
 */
export type ConversationMetadata = ConversationHistoryMetadata;

/**
 * 事件查询参数
 *
 * 功能 (What): 定义获取会话事件时的查询条件
 *
 * @property limit - 每页返回的事件数量，默认 50
 * @property cursor - 游标，用于分页，通常是事件 ID 或序号
 * @property direction - 分页方向，'forward' 向前（旧到新），'backward' 向后（新到旧），默认 'backward'
 * @property excludeTypes - 只给 UI 分页链路使用的类型级排除清单；全量回放不传，保持事实读取无损
 */
export interface ReadEventsQuery {
  limit?: number;
  cursor?: number;
  direction?: 'forward' | 'backward';
  excludeTypes?: readonly string[];
}

/**
 * 事件查询响应
 *
 * 功能 (What): 定义 API 返回的事件列表结构
 *
 * @property events - 运行时事件数组
 * @property next_cursor - 下一页的游标，如果没有更多数据则为 undefined
 * @property has_more - 是否还有更多数据
 * @property revision - 当前的版本号
 */
export interface ReadEventsResponse {
  events: RuntimeEvent[];
  next_cursor?: number;
  has_more: boolean;
  revision: number;
}

/**
 * 更新标题请求体
 *
 * 功能 (What): 定义更新会话标题的请求参数
 *
 * @property title - 新的标题文本，不能为空
 */
export interface UpdateTitleRequest {
  title: string;
}

/**
 * 更新置顶请求体
 *
 * @property pinned - true 表示置顶，false 表示取消置顶
 */
export interface UpdatePinnedRequest {
  pinned: boolean;
}

/**
 * 删除会话响应
 *
 * 功能 (What): 定义删除会话操作的响应
 *
 * @property success - 操作是否成功
 * @property message - 成功或失败的消息
 */
export interface DeleteConversationResponse {
  success: boolean;
  message: string;
}
