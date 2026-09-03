import { apiFetch, getApiBaseUrl } from '@shared/services/aiService/common';
import { isRecord } from '../../utils/typeGuards';
import {
  ConversationHistoryListResponseSchema,
  ConversationHistoryMetadataResponseSchema,
  ConversationCleanupRetryResponseSchema,
  UpdateConversationSelectedAgentRequestSchema,
  UpdateConversationSelectedAgentResponseSchema,
  type ConversationHistoryListItem,
  type ConversationHistoryMetadata,
  type ConversationSelectedAgentId,
  type ConversationCleanupRetryOutcome,
} from '@app/schemas';

function readNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * 会话列表项接口
 */
export type ConversationListItem = ConversationHistoryListItem;
export type ConversationMetadata = ConversationHistoryMetadata;

/**
 * 会话列表响应接口
 */
export interface ConversationListResponse {
  conversations: ConversationListItem[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface UpdatePinnedResponse {
  isPinned: boolean;
  pinnedAt?: number;
}

/**
 * 会话历史服务类
 */
export class HistoryApiService {
  /**
   * 获取会话列表（分页）
   * 
   * @param options 查询选项
   * @param options.limit 每页数量，默认 30
   * @param options.cursor opaque string keyset 游标
   * @param options.search 搜索关键词
   * @param options.projectId 按项目ID筛选
   * @returns 会话列表响应
   */
  async fetchList(options?: {
    limit?: number;
    cursor?: string;
    search?: string;
    projectId?: string; // 新增：按项目ID筛选
  }): Promise<ConversationListResponse> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.search) params.set('search', options.search);
    if (options?.projectId) params.set('projectId', options.projectId); // 新增：添加 projectId 到 URL 参数

    try {
      // 🔥 使用动态端口获取
      const baseUrl = await getApiBaseUrl();
      const url = `${baseUrl}/api/v1/conversation/list${params.toString() ? `?${params}` : ''}`;

      const response = await apiFetch(url);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to fetch conversation list`);
      }

      const data = ConversationHistoryListResponseSchema.parse(await response.json());

      return {
        conversations: data.conversations,
        nextCursor: data.next_cursor,
        hasMore: data.has_more,
      };
    } catch (error) {
      console.error('[ConversationHistoryService] 获取会话列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取会话元数据
   * 
   * @param conversationId 会话 ID
   * @returns 会话元数据，如果不存在则返回 null
   */
  async fetchMetadata(conversationId: string): Promise<ConversationMetadata | null> {
    if (!conversationId) {
      throw new Error('conversationId is required');
    }

    try {
      // 🔥 使用动态端口获取
      const baseUrl = await getApiBaseUrl();
      const url = `${baseUrl}/api/v1/conversation/${conversationId}/metadata`;

      const response = await apiFetch(url);
      
      if (response.status === 404) {
        console.warn('[ConversationHistoryService] 会话不存在:', conversationId);
        return null;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to fetch conversation metadata`);
      }

      const { success: _success, ...metadata } = ConversationHistoryMetadataResponseSchema.parse(
        await response.json(),
      );
      return metadata;
    } catch (error) {
      console.error('[ConversationHistoryService] 获取会话元数据失败:', error);
      throw error;
    }
  }

  /**
   * 更新会话标题
   * 
   * @param conversationId 会话 ID
   * @param title 新标题
   * @returns 是否更新成功
   */
  async updateTitle(conversationId: string, title: string): Promise<boolean> {
    if (!conversationId) {
      throw new Error('conversationId is required');
    }
    if (!title || !title.trim()) {
      throw new Error('title is required');
    }

    try {
      // 🔥 使用动态端口获取
      const baseUrl = await getApiBaseUrl();
      const url = `${baseUrl}/api/v1/conversation/${conversationId}/title`;

      const response = await apiFetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: title.trim() }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to update conversation title`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'API returned success: false');
      }

      return true;
    } catch (error) {
      console.error('[ConversationHistoryService] 更新会话标题失败:', error);
      throw error;
    }
  }

  /**
   * 更新会话置顶状态
   *
   * @param conversationId 会话 ID
   * @param pinned true 为置顶，false 为取消置顶
   */
  async updatePinned(conversationId: string, pinned: boolean): Promise<UpdatePinnedResponse> {
    if (!conversationId) {
      throw new Error('conversationId is required');
    }

    try {
      const baseUrl = await getApiBaseUrl();
      const url = `${baseUrl}/api/v1/conversation/${conversationId}/pinned`;

      const response = await apiFetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pinned }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to update conversation pinned state`);
      }

      const data = await response.json();

      if (!isRecord(data) || data.success !== true) {
        const err = isRecord(data) && typeof data.error === 'string' ? data.error : 'API returned success: false';
        throw new Error(err);
      }

      return {
        isPinned: data.is_pinned === true,
        pinnedAt: readNumber(data.pinned_at),
      };
    } catch (error) {
      console.error('[ConversationHistoryService] 更新会话置顶状态失败:', error);
      throw error;
    }
  }

  /** 持久化会话级 Agent 产品身份；null 表示恢复默认 Agent。 */
  async updateSelectedAgent(
    conversationId: string,
    selectedAgentId: ConversationSelectedAgentId | null,
    projectId: string | null,
  ): Promise<ConversationSelectedAgentId | null> {
    if (!conversationId) {
      throw new Error('conversationId is required');
    }

    const request = UpdateConversationSelectedAgentRequestSchema.parse({
      selected_agent_id: selectedAgentId,
      project_id: projectId,
    });
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(
      `${baseUrl}/api/v1/conversation/${conversationId}/selected-agent`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message = isRecord(errorData) && typeof errorData.error === 'string'
        ? errorData.error
        : `HTTP ${response.status}: Failed to update conversation selected agent`;
      throw new Error(message);
    }

    return UpdateConversationSelectedAgentResponseSchema.parse(
      await response.json(),
    ).selected_agent_id;
  }

  /**
   * 删除会话
   * 
   * @param conversationId 会话 ID
   * @returns 是否删除成功
   */
  async deleteConversation(conversationId: string): Promise<boolean> {
    if (!conversationId) {
      throw new Error('conversationId is required');
    }

    try {
      // 🔥 使用动态端口获取
      const baseUrl = await getApiBaseUrl();
      const url = `${baseUrl}/api/v1/conversation/${conversationId}`;

      const response = await apiFetch(url, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to delete conversation`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'API returned success: false');
      }

      return true;
    } catch (error) {
      console.error('[ConversationHistoryService] 删除会话失败:', error);
      throw error;
    }
  }

  async retryPendingCleanup(conversationId: string): Promise<ConversationCleanupRetryOutcome> {
    if (!conversationId) throw new Error('conversationId is required');
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(
      `${baseUrl}/api/v1/conversation/${conversationId}/cleanup/retry`,
      { method: 'POST' },
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        isRecord(errorData) && typeof errorData.error === 'string'
          ? errorData.error
          : `HTTP ${response.status}: Failed to retry conversation cleanup`,
      );
    }
    return ConversationCleanupRetryResponseSchema.parse(await response.json()).outcome;
  }
}

/**
 * 默认导出单例实例
 */
export const historyApiService = new HistoryApiService();
