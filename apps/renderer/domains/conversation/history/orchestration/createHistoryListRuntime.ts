import {
  getNavigationScopeKey as getScopeKey,
  useNavigationScope,
  type NavigationScope,
} from '@/app/navigation';
import { historyApiService, type ConversationListItem } from '../services/historyApiService';
import type { LoadScopeListOptions } from '../definitions/historyList';
import type { useHistoryListState } from '../store/historyListStore';
import {
  cloneScope,
  cloneConversations,
  createEmptySnapshot,
  getScopeForConversation,
  isConversationInScope,
  projectUpdatedHistoryList,
  projectLoadedHistoryList,
  projectUpsertedHistoryList,
  projectTouchedHistoryList,
} from '../functions/historyListProjection';
const HISTORY_LIST_LOAD_FAILED = 'load_failed';
export function createHistoryListRuntime(state: ReturnType<typeof useHistoryListState>) {
  let scopeListenersRegistered = false;
  let lastSubscribedScope: NavigationScope | null = null;
  function syncCurrentScopeFromSnapshot(scope?: NavigationScope) {
    const navigationScope = useNavigationScope();
    const targetScope = scope ? cloneScope(scope) : navigationScope.currentScope;
    if (getScopeKey(targetScope) !== navigationScope.currentScopeKey) return;

    const snapshot = state.ensureScopeSnapshot(targetScope);
    state.patchCurrentState({ conversations: cloneConversations(snapshot.conversations) });
    state.patchCurrentState({ nextCursor: snapshot.nextCursor });
    state.patchCurrentState({ hasMore: snapshot.hasMore });
    state.patchCurrentState({ searchQuery: snapshot.searchQuery });
    state.patchCurrentState({ lastRefreshTime: snapshot.lastRefreshTime });
    state.patchCurrentState({ isLoading: snapshot.isLoading });
    state.patchCurrentState({ error: snapshot.error });
  }

  function persistScopeSnapshot(scope?: NavigationScope) {
    const navigationScope = useNavigationScope();
    const key = getScopeKey(scope ? cloneScope(scope) : navigationScope.currentScope);
    state.setScopeSnapshot(key, {
      conversations: cloneConversations(state.conversations),
      nextCursor: state.nextCursor,
      hasMore: state.hasMore,
      isComplete: state.hasMore === false,
      isLoading: state.isLoading,
      error: state.error,
      lastRefreshTime: state.lastRefreshTime,
      searchQuery: state.searchQuery,
    });
  }

  function restoreScopeSnapshot(scope?: NavigationScope) {
    const navigationScope = useNavigationScope();
    const key = getScopeKey(scope ? cloneScope(scope) : navigationScope.currentScope);
    const snapshot = state.scopeCache[key];
    if (snapshot) {
      state.patchCurrentState({ conversations: cloneConversations(snapshot.conversations) });
      state.patchCurrentState({ nextCursor: snapshot.nextCursor });
      state.patchCurrentState({ hasMore: snapshot.hasMore });
      state.patchCurrentState({ lastRefreshTime: snapshot.lastRefreshTime });
      state.patchCurrentState({ searchQuery: snapshot.searchQuery });
      state.patchCurrentState({ error: snapshot.error });
      state.patchCurrentState({ isLoading: snapshot.isLoading });
    } else {
      state.setScopeSnapshot(key, createEmptySnapshot());
      state.patchCurrentState({ conversations: [] });
      state.patchCurrentState({ nextCursor: undefined });
      state.patchCurrentState({ hasMore: true });
      state.patchCurrentState({ searchQuery: '' });
      state.patchCurrentState({ error: null });
      state.patchCurrentState({ isLoading: false });
      state.patchCurrentState({ lastRefreshTime: 0 });
    }
  }

  function ensureScopeSubscription() {
    if (scopeListenersRegistered) return;
    const navigationScope = useNavigationScope();
    lastSubscribedScope = cloneScope(navigationScope.currentScope);

    navigationScope.onScopeDidChange(({ scope }) => {
      const previousScope = lastSubscribedScope;
      const nextScope = cloneScope(scope);
      if (previousScope && getScopeKey(previousScope) === getScopeKey(nextScope)) {
        return;
      }
      if (previousScope) {
        persistScopeSnapshot(previousScope);
      }
      state.patchCurrentState({ isLoading: false });
      restoreScopeSnapshot(nextScope);
      void loadList(true);
      lastSubscribedScope = nextScope;
    });

    if (state.conversations.length === 0 && !state.isLoading) {
      restoreScopeSnapshot(navigationScope.currentScope);
    }

    scopeListenersRegistered = true;
  }

  async function loadList(refresh = false) {
    ensureScopeSubscription();
    const navigationScope = useNavigationScope();
    await loadScopeList(navigationScope.currentScope, {
      refresh,
      limit: 30,
      loadAll: false,
      search: state.searchQuery || undefined,
    });
  }

  async function loadScopeList(scope: NavigationScope, options?: LoadScopeListOptions) {
    ensureScopeSubscription();
    const targetScope = cloneScope(scope);
    const snapshot = state.ensureScopeSnapshot(targetScope);
    const refresh = options?.refresh === true;
    const loadAll = options?.loadAll === true;
    const limit = options?.limit ?? 30;
    const search = options?.search?.trim() ?? '';

    if (refresh) {
      state.patchSnapshot(snapshot, { nextCursor: undefined });
      state.patchSnapshot(snapshot, { hasMore: true });
      state.patchSnapshot(snapshot, { isComplete: false });
      state.patchSnapshot(snapshot, { error: null });
    }

    if (snapshot.isLoading || !snapshot.hasMore) {
      syncCurrentScopeFromSnapshot(targetScope);
      return;
    }

    state.patchSnapshot(snapshot, { isLoading: true });
    state.patchSnapshot(snapshot, { error: null });
    state.patchSnapshot(snapshot, { searchQuery: search });
    syncCurrentScopeFromSnapshot(targetScope);

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
        loadAll &&
        result.hasMore &&
        typeof result.nextCursor === 'string' &&
        state.scopeCache[requestScopeKey] === snapshot
      ) {
        result = await historyApiService.fetchList({
          limit,
          cursor: result.nextCursor,
          search: search || undefined,
          projectId,
        });
        loadedConversations.push(...result.conversations);
      }

      if (state.scopeCache[requestScopeKey] !== snapshot) return;

      state.patchSnapshot(snapshot, {
        conversations: projectLoadedHistoryList(
          loadedConversations,
          state.forgottenConversationIds
        ),
      });
      state.patchSnapshot(snapshot, { nextCursor: result.nextCursor });
      state.patchSnapshot(snapshot, { hasMore: result.hasMore });
      state.patchSnapshot(snapshot, { isComplete: !result.hasMore });
      state.patchSnapshot(snapshot, { lastRefreshTime: Date.now() });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      state.patchSnapshot(snapshot, { error: HISTORY_LIST_LOAD_FAILED });
      console.error('[ConversationListStore] 加载会话列表失败:', error);
    } finally {
      state.patchSnapshot(snapshot, { isLoading: false });
      syncCurrentScopeFromSnapshot(targetScope);
    }
  }

  async function refresh() {
    console.log('[ConversationListStore] 刷新会话列表');
    await loadList(true);
  }

  function updateConversation(conversationId: string, updates: Partial<ConversationListItem>) {
    ensureScopeSubscription();
    const safeConversationId = conversationId.trim();
    if (!safeConversationId) return;

    Object.entries(state.scopeCache).forEach(([key, snapshot]) => {
      const index = snapshot.conversations.findIndex(
        conversation => conversation.conversation_id === safeConversationId
      );
      if (index === -1) return;

      state.patchSnapshot(snapshot, {
        conversations: projectUpdatedHistoryList(
          snapshot.conversations,
          safeConversationId,
          updates
        ),
      });
      state.patchSnapshot(snapshot, { lastRefreshTime: Date.now() });
      if (key === useNavigationScope().currentScopeKey) {
        syncCurrentScopeFromSnapshot();
      }
    });
    console.log('[ConversationListStore] 更新会话元数据:', conversationId, updates);
  }

  function upsertConversation(conversation: ConversationListItem) {
    ensureScopeSubscription();
    if (state.forgottenConversationIds.includes(conversation.conversation_id)) return;
    const targetScope = getScopeForConversation(conversation);
    const targetScopeKey = getScopeKey(targetScope);
    const targetSnapshot = state.ensureScopeSnapshot(targetScope);

    const nextConversation = { ...conversation };

    Object.entries(state.scopeCache).forEach(([key, snapshot]) => {
      if (key === targetScopeKey) return;

      const nextConversations = snapshot.conversations.filter(
        candidate => candidate.conversation_id !== conversation.conversation_id
      );
      if (nextConversations.length !== snapshot.conversations.length) {
        state.patchSnapshot(snapshot, { conversations: nextConversations });
        state.patchSnapshot(snapshot, { lastRefreshTime: Date.now() });
      }
    });

    state.patchSnapshot(targetSnapshot, {
      conversations: projectUpsertedHistoryList(targetSnapshot.conversations, nextConversation),
    });
    state.patchSnapshot(targetSnapshot, { lastRefreshTime: Date.now() });
    syncCurrentScopeFromSnapshot(targetScope);
  }

  function upsertConversationForScope(scope: NavigationScope, conversation: ConversationListItem) {
    ensureScopeSubscription();
    if (!isConversationInScope(conversation, scope)) {
      removeConversation(conversation.conversation_id);
      return;
    }
    upsertConversation(conversation);
  }

  function updatePinnedState(conversationId: string, isPinned: boolean, pinnedAt?: number) {
    updateConversation(conversationId, {
      is_pinned: isPinned,
      pinned_at: pinnedAt,
    });
  }

  async function updatePinned(conversationId: string, pinned: boolean) {
    const result = await historyApiService.updatePinned(conversationId, pinned);
    updatePinnedState(conversationId, result.isPinned, result.pinnedAt);
    return result;
  }

  function removeConversation(conversationId: string) {
    ensureScopeSubscription();
    const safeConversationId = conversationId.trim();
    if (!safeConversationId) return;

    Object.values(state.scopeCache).forEach(snapshot => {
      const nextConversations = snapshot.conversations.filter(
        conversation => conversation.conversation_id !== safeConversationId
      );
      if (nextConversations.length === snapshot.conversations.length) return;

      state.patchSnapshot(snapshot, { conversations: nextConversations });
      state.patchSnapshot(snapshot, { lastRefreshTime: Date.now() });
    });

    state.patchCurrentState({
      conversations: state.conversations.filter(
        conversation => conversation.conversation_id !== safeConversationId
      ),
    });
    syncCurrentScopeFromSnapshot();
    console.log('[ConversationListStore] 移除会话:', conversationId);
  }

  function forgetConversation(conversationId: string) {
    const safeConversationId = conversationId.trim();
    if (!safeConversationId) return;
    if (!state.forgottenConversationIds.includes(safeConversationId)) {
      state.rememberForgottenId(safeConversationId);
    }
    removeConversation(safeConversationId);
  }

  function touchConversationTimestamp(conversationId: string, lastEventAt: number) {
    ensureScopeSubscription();
    const safeConversationId = conversationId.trim();
    if (!safeConversationId || !Number.isFinite(lastEventAt) || lastEventAt <= 0) return;

    Object.values(state.scopeCache).forEach(snapshot => {
      const { conversations, didUpdate } = projectTouchedHistoryList(
        snapshot.conversations,
        safeConversationId,
        lastEventAt
      );
      state.patchSnapshot(snapshot, { conversations: conversations });

      if (didUpdate) {
        state.patchSnapshot(snapshot, { lastRefreshTime: Date.now() });
      }
    });
    syncCurrentScopeFromSnapshot();
  }

  function prependConversation(conversation: ConversationListItem) {
    upsertConversation(conversation);
    console.log('[ConversationListStore] 添加或更新会话:', conversation.conversation_id);
  }
  return {
    syncCurrentScopeFromSnapshot,
    persistScopeSnapshot,
    restoreScopeSnapshot,
    ensureScopeSubscription,
    loadList,
    loadScopeList,
    refresh,
    updateConversation,
    upsertConversation,
    upsertConversationForScope,
    updatePinnedState,
    updatePinned,
    removeConversation,
    forgetConversation,
    touchConversationTimestamp,
    prependConversation,
  };
}
