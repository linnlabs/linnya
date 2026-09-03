/**
 * @file apps/renderer/domains/conversation/history/store/historyListStore.ts
 * @description 会话列表状态管理（Pinia Store）
 * 
 * 职责：
 * - 管理会话列表数据和分页状态
 * - 处理会话搜索
 * - 处理会话列表的加载和刷新
 * - 提供会话列表的计算属性
 */

import { defineStore } from 'pinia';
import { historyApiService } from '../services/historyApiService';
import type { ConversationListItem } from '../services/historyApiService';
import { sortSidebarConversations } from '../../functions/sidebarConversationListSort';
import {
  getWorkspaceScopeKey,
  useWorkspaceScopeStore,
  type WorkspaceScope,
} from '../../../../shared/stores/workspaceScopeStore';

function cloneScope(scope: WorkspaceScope): WorkspaceScope {
  return scope.kind === 'project'
    ? { kind: 'project', projectId: scope.projectId }
    : { kind: 'linnya-assistant' };
}

const getScopeKey = (scope: WorkspaceScope) => getWorkspaceScopeKey(scope);

interface ScopeCacheSnapshot {
  conversations: ConversationListItem[];
  nextCursor?: string;
  hasMore: boolean;
  isComplete: boolean;
  isLoading: boolean;
  error: string | null;
  lastRefreshTime: number;
  searchQuery: string;
}

const HISTORY_LIST_LOAD_FAILED = 'load_failed';

interface LoadScopeListOptions {
  refresh?: boolean;
  loadAll?: boolean;
  limit?: number;
  search?: string;
}

let scopeListenersRegistered = false;
let lastSubscribedScope: WorkspaceScope | null = null;

function createEmptySnapshot(): ScopeCacheSnapshot {
  return {
    conversations: [],
    nextCursor: undefined,
    hasMore: true,
    isComplete: false,
    isLoading: false,
    error: null,
    lastRefreshTime: 0,
    searchQuery: '',
  };
}

function getScopeForConversation(conversation: ConversationListItem): WorkspaceScope {
  return typeof conversation.project_id === 'string' && conversation.project_id.trim().length > 0
    ? { kind: 'project', projectId: conversation.project_id }
    : { kind: 'linnya-assistant' };
}

function isConversationInScope(conversation: ConversationListItem, scope: WorkspaceScope): boolean {
  return scope.kind === 'project'
    ? conversation.project_id === scope.projectId
    : !conversation.project_id;
}

function cloneConversations(conversations: ConversationListItem[]): ConversationListItem[] {
  return conversations.map(conversation => ({ ...conversation }));
}

export const useHistoryListStore = defineStore('historyList', {
  state: () => ({
    // 会话列表数据
    conversations: [] as ConversationListItem[],
    
    // 加载状态
    isLoading: false,
    
    // 错误信息
    error: null as string | null,
    
    // 分页游标（后端返回的列表排序游标，已包含置顶排序位置）
    nextCursor: undefined as string | undefined,
    
    // 是否还有更多数据
    hasMore: true,
    
    // 搜索关键词
    searchQuery: '',
    
    // 最后刷新时间
    lastRefreshTime: 0,
    // 作用域缓存（按 WorkspaceScope 存储最近一次成功加载的快照）
    scopeCache: {} as Record<string, ScopeCacheSnapshot>,

    // 后端已确认删除的身份；阻止删除前发出的列表请求或迟到同步在本次运行期复活旧事实。
    forgottenConversationIds: [] as string[],
  }),

  getters: {
    getConversationsByScope: (state) => (scope: WorkspaceScope): ConversationListItem[] => {
      return state.scopeCache[getScopeKey(scope)]?.conversations ?? [];
    },

    isLoadingByScope: (state) => (scope: WorkspaceScope): boolean => {
      return state.scopeCache[getScopeKey(scope)]?.isLoading ?? false;
    },

    errorByScope: (state) => (scope: WorkspaceScope): string | null => {
      return state.scopeCache[getScopeKey(scope)]?.error ?? null;
    },

    hasLoadedScope: (state) => (scope: WorkspaceScope): boolean => {
      const snapshot = state.scopeCache[getScopeKey(scope)];
      return !!snapshot && (snapshot.lastRefreshTime > 0 || snapshot.conversations.length > 0);
    },

    isScopeComplete: (state) => (scope: WorkspaceScope): boolean => {
      return state.scopeCache[getScopeKey(scope)]?.isComplete ?? false;
    },
  },

  actions: {
    ensureScopeSnapshot(scope: WorkspaceScope): ScopeCacheSnapshot {
      const key = getScopeKey(scope);
      const existing = this.scopeCache[key];
      if (existing) return existing;

      this.scopeCache[key] = createEmptySnapshot();
      /**
       * 中文说明：
       * - 新建快照必须从 Pinia state 里重新取一次，拿到 Vue 代理对象；
       * - 如果继续返回 createEmptySnapshot() 的原始对象，后续 isLoading/conversations 写入不会触发响应式更新；
       * - 这会让首屏默认展开的侧栏对话停在“加载中”，直到折叠再展开才重新读取到最新值。
       */
      return this.scopeCache[key];
    },

    syncCurrentScopeFromSnapshot(scope?: WorkspaceScope) {
      const workspaceScope = useWorkspaceScopeStore();
      const targetScope = scope ? cloneScope(scope) : workspaceScope.currentScope;
      if (getScopeKey(targetScope) !== workspaceScope.currentScopeKey) return;

      const snapshot = this.ensureScopeSnapshot(targetScope);
      this.conversations = cloneConversations(snapshot.conversations);
      this.nextCursor = snapshot.nextCursor;
      this.hasMore = snapshot.hasMore;
      this.searchQuery = snapshot.searchQuery;
      this.lastRefreshTime = snapshot.lastRefreshTime;
      this.isLoading = snapshot.isLoading;
      this.error = snapshot.error;
    },

    persistScopeSnapshot(scope?: WorkspaceScope) {
      const workspaceScope = useWorkspaceScopeStore();
      const key = getScopeKey(scope ? cloneScope(scope) : workspaceScope.currentScope);
      this.scopeCache[key] = {
        conversations: cloneConversations(this.conversations),
        nextCursor: this.nextCursor,
        hasMore: this.hasMore,
        isComplete: this.hasMore === false,
        isLoading: this.isLoading,
        error: this.error,
        lastRefreshTime: this.lastRefreshTime,
        searchQuery: this.searchQuery,
      };
    },

    restoreScopeSnapshot(scope?: WorkspaceScope) {
      const workspaceScope = useWorkspaceScopeStore();
      const key = getScopeKey(scope ? cloneScope(scope) : workspaceScope.currentScope);
      const snapshot = this.scopeCache[key];
      if (snapshot) {
        this.conversations = cloneConversations(snapshot.conversations);
        this.nextCursor = snapshot.nextCursor;
        this.hasMore = snapshot.hasMore;
        this.lastRefreshTime = snapshot.lastRefreshTime;
        this.searchQuery = snapshot.searchQuery;
        this.error = snapshot.error;
        this.isLoading = snapshot.isLoading;
      } else {
        this.scopeCache[key] = createEmptySnapshot();
        this.conversations = [];
        this.nextCursor = undefined;
        this.hasMore = true;
        this.searchQuery = '';
        this.error = null;
        this.isLoading = false;
        this.lastRefreshTime = 0;
      }
    },

    ensureScopeSubscription() {
      if (scopeListenersRegistered) return;
      const workspaceScope = useWorkspaceScopeStore();
      lastSubscribedScope = cloneScope(workspaceScope.currentScope);

      workspaceScope.onScopeDidChange(({ scope }) => {
        const previousScope = lastSubscribedScope;
        const nextScope = cloneScope(scope);
        if (previousScope && getScopeKey(previousScope) === getScopeKey(nextScope)) {
          return;
        }
        if (previousScope) {
          this.persistScopeSnapshot(previousScope);
        }
        this.isLoading = false;
        this.restoreScopeSnapshot(nextScope);
        void this.loadList(true);
        lastSubscribedScope = nextScope;
      });

      if (this.conversations.length === 0 && !this.isLoading) {
        this.restoreScopeSnapshot(workspaceScope.currentScope);
      }

      scopeListenersRegistered = true;
    },

    /**
     * 加载会话列表（首次或刷新）
     * 
     * @param refresh 是否刷新（清空现有数据）
     */
    async loadList(refresh = false) {
      this.ensureScopeSubscription();
      const workspaceScope = useWorkspaceScopeStore();
      await this.loadScopeList(workspaceScope.currentScope, {
        refresh,
        limit: 30,
        loadAll: false,
        search: this.searchQuery || undefined,
      });
    },

    async loadScopeList(scope: WorkspaceScope, options?: LoadScopeListOptions) {
      this.ensureScopeSubscription();
      const targetScope = cloneScope(scope);
      const snapshot = this.ensureScopeSnapshot(targetScope);
      const refresh = options?.refresh === true;
      const loadAll = options?.loadAll === true;
      const limit = options?.limit ?? 30;
      const search = options?.search?.trim() ?? '';

      if (refresh) {
        snapshot.nextCursor = undefined;
        snapshot.hasMore = true;
        snapshot.isComplete = false;
        snapshot.error = null;
      }

      if (snapshot.isLoading || !snapshot.hasMore) {
        this.syncCurrentScopeFromSnapshot(targetScope);
        return;
      }

      snapshot.isLoading = true;
      snapshot.error = null;
      snapshot.searchQuery = search;
      this.syncCurrentScopeFromSnapshot(targetScope);

      const requestScopeKey = getScopeKey(targetScope);
      const projectId = targetScope.kind === 'project' ? targetScope.projectId : undefined;

      try {
        let result = await historyApiService.fetchList({
          limit,
          cursor: snapshot.nextCursor,
          search: search || undefined,
          projectId,
        });
        const loadedConversations = refresh
          ? [...result.conversations]
          : [...snapshot.conversations, ...result.conversations];

        while (
          loadAll
          && result.hasMore
          && typeof result.nextCursor === 'string'
          && this.scopeCache[requestScopeKey] === snapshot
        ) {
          result = await historyApiService.fetchList({
            limit,
            cursor: result.nextCursor,
            search: search || undefined,
            projectId,
          });
          loadedConversations.push(...result.conversations);
        }

        if (this.scopeCache[requestScopeKey] !== snapshot) return;

        snapshot.conversations = sortSidebarConversations(cloneConversations(
          loadedConversations.filter(conversation => (
            !this.forgottenConversationIds.includes(conversation.conversation_id)
          )),
        ));
        snapshot.nextCursor = result.nextCursor;
        snapshot.hasMore = result.hasMore;
        snapshot.isComplete = !result.hasMore;
        snapshot.lastRefreshTime = Date.now();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        snapshot.error = HISTORY_LIST_LOAD_FAILED;
        console.error('[ConversationListStore] 加载会话列表失败:', error);
      } finally {
        snapshot.isLoading = false;
        this.syncCurrentScopeFromSnapshot(targetScope);
      }
    },

    /**
     * 刷新列表（重新加载）
     */
    async refresh() {
      console.log('[ConversationListStore] 刷新会话列表');
      await this.loadList(true);
    },

    /**
     * 更新单个会话的元数据（例如标题）
     * 
     * @param conversationId 会话 ID
     * @param updates 要更新的字段
     */
    updateConversation(conversationId: string, updates: Partial<ConversationListItem>) {
      this.ensureScopeSubscription();
      const safeConversationId = conversationId.trim();
      if (!safeConversationId) return;

      Object.entries(this.scopeCache).forEach(([key, snapshot]) => {
        const index = snapshot.conversations.findIndex(conversation => (
          conversation.conversation_id === safeConversationId
        ));
        if (index === -1) return;

        snapshot.conversations = sortSidebarConversations(
          snapshot.conversations.map(conversation => (
            conversation.conversation_id === safeConversationId
              ? { ...conversation, ...updates }
              : conversation
          )),
        );
        snapshot.lastRefreshTime = Date.now();
        if (key === useWorkspaceScopeStore().currentScopeKey) {
          this.syncCurrentScopeFromSnapshot();
        }
      });
      console.log('[ConversationListStore] 更新会话元数据:', conversationId, updates);
    },

    upsertConversation(conversation: ConversationListItem) {
      this.ensureScopeSubscription();
      if (this.forgottenConversationIds.includes(conversation.conversation_id)) return;
      const targetScope = getScopeForConversation(conversation);
      const targetScopeKey = getScopeKey(targetScope);
      const targetSnapshot = this.ensureScopeSnapshot(targetScope);

      const nextConversation = { ...conversation };

      Object.entries(this.scopeCache).forEach(([key, snapshot]) => {
        if (key === targetScopeKey) return;

        const nextConversations = snapshot.conversations.filter(candidate => (
          candidate.conversation_id !== conversation.conversation_id
        ));
        if (nextConversations.length !== snapshot.conversations.length) {
          snapshot.conversations = nextConversations;
          snapshot.lastRefreshTime = Date.now();
        }
      });

      const index = targetSnapshot.conversations.findIndex(candidate => (
        candidate.conversation_id === conversation.conversation_id
      ));

      targetSnapshot.conversations = sortSidebarConversations(
        index === -1
          ? [nextConversation, ...targetSnapshot.conversations]
          : targetSnapshot.conversations.map(candidate => (
            candidate.conversation_id === conversation.conversation_id
              ? { ...candidate, ...nextConversation }
              : candidate
          )),
      );
      targetSnapshot.lastRefreshTime = Date.now();
      this.syncCurrentScopeFromSnapshot(targetScope);
    },

    upsertConversationForScope(scope: WorkspaceScope, conversation: ConversationListItem) {
      this.ensureScopeSubscription();
      if (!isConversationInScope(conversation, scope)) {
        this.removeConversation(conversation.conversation_id);
        return;
      }
      this.upsertConversation(conversation);
    },

    updatePinnedState(conversationId: string, isPinned: boolean, pinnedAt?: number) {
      this.updateConversation(conversationId, {
        is_pinned: isPinned,
        pinned_at: pinnedAt,
      });
    },

    async updatePinned(conversationId: string, pinned: boolean) {
      const result = await historyApiService.updatePinned(conversationId, pinned);
      this.updatePinnedState(conversationId, result.isPinned, result.pinnedAt);
      return result;
    },

    removeConversation(conversationId: string) {
      this.ensureScopeSubscription();
      const safeConversationId = conversationId.trim();
      if (!safeConversationId) return;

      Object.values(this.scopeCache).forEach((snapshot) => {
        const nextConversations = snapshot.conversations.filter(conversation => (
          conversation.conversation_id !== safeConversationId
        ));
        if (nextConversations.length === snapshot.conversations.length) return;

        snapshot.conversations = nextConversations;
        snapshot.lastRefreshTime = Date.now();
      });

      this.conversations = this.conversations.filter(conversation => (
        conversation.conversation_id !== safeConversationId
      ));
      this.syncCurrentScopeFromSnapshot();
      console.log('[ConversationListStore] 移除会话:', conversationId);
    },

    forgetConversation(conversationId: string) {
      const safeConversationId = conversationId.trim();
      if (!safeConversationId) return;
      if (!this.forgottenConversationIds.includes(safeConversationId)) {
        this.forgottenConversationIds = [...this.forgottenConversationIds, safeConversationId];
      }
      this.removeConversation(safeConversationId);
    },

    touchConversationTimestamp(conversationId: string, lastEventAt: number) {
      this.ensureScopeSubscription();
      const safeConversationId = conversationId.trim();
      if (!safeConversationId || !Number.isFinite(lastEventAt) || lastEventAt <= 0) return;

      Object.values(this.scopeCache).forEach((snapshot) => {
        let didUpdate = false;
        snapshot.conversations = sortSidebarConversations(
          snapshot.conversations.map(conversation => {
            if (conversation.conversation_id !== safeConversationId) {
              return conversation;
            }

            const nextLastEventAt = Math.max(conversation.last_event_at, Math.floor(lastEventAt));
            if (nextLastEventAt === conversation.last_event_at) {
              return conversation;
            }

            didUpdate = true;
            return {
              ...conversation,
              last_event_at: nextLastEventAt,
            };
          }),
        );

        if (didUpdate) {
          snapshot.lastRefreshTime = Date.now();
        }
      });
      this.syncCurrentScopeFromSnapshot();
    },

    /**
     * 添加新会话到列表顶部
     * 
     * @param conversation 新会话数据
     */
    prependConversation(conversation: ConversationListItem) {
      this.upsertConversation(conversation);
      console.log('[ConversationListStore] 添加或更新会话:', conversation.conversation_id);
    },

  },
});
