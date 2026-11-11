import { defineStore } from 'pinia';
import { getNavigationScopeKey as getScopeKey, type NavigationScope } from '@/app/navigation';
import type { ConversationListItem } from '../services/historyApiService';
import type {
  HistoryListState,
  HistoryListCurrentState,
  ScopeCacheSnapshot,
} from '../definitions/historyList';
import { createEmptySnapshot } from '../functions/historyListProjection';
export const useHistoryListState = defineStore('historyList', {
  state: (): HistoryListState => ({
    // 会话列表数据
    conversations: [],

    // 加载状态
    isLoading: false,

    // 错误信息
    error: null,

    // 分页游标（后端返回的列表排序游标，已包含置顶排序位置）
    nextCursor: undefined,

    // 是否还有更多数据
    hasMore: true,

    // 搜索关键词
    searchQuery: '',

    // 最后刷新时间
    lastRefreshTime: 0,
    // 作用域缓存（按 NavigationScope 存储最近一次成功加载的快照）
    scopeCache: {},

    // 后端已确认删除的身份；阻止删除前发出的列表请求或迟到同步在本次运行期复活旧事实。
    forgottenConversationIds: [],
  }),
  getters: {
    getConversationsByScope:
      state =>
      (scope: NavigationScope): ConversationListItem[] => {
        return state.scopeCache[getScopeKey(scope)]?.conversations ?? [];
      },

    isLoadingByScope:
      state =>
      (scope: NavigationScope): boolean => {
        return state.scopeCache[getScopeKey(scope)]?.isLoading ?? false;
      },

    errorByScope:
      state =>
      (scope: NavigationScope): string | null => {
        return state.scopeCache[getScopeKey(scope)]?.error ?? null;
      },

    hasLoadedScope:
      state =>
      (scope: NavigationScope): boolean => {
        const snapshot = state.scopeCache[getScopeKey(scope)];
        return !!snapshot && (snapshot.lastRefreshTime > 0 || snapshot.conversations.length > 0);
      },

    isScopeComplete:
      state =>
      (scope: NavigationScope): boolean => {
        return state.scopeCache[getScopeKey(scope)]?.isComplete ?? false;
      },
  },
  actions: {
    ensureScopeSnapshot(scope: NavigationScope): ScopeCacheSnapshot {
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
    patchCurrentState(changes: Partial<HistoryListCurrentState>): void {
      Object.assign(this, changes);
    },
    patchSnapshot(snapshot: ScopeCacheSnapshot, changes: Partial<ScopeCacheSnapshot>): void {
      Object.assign(snapshot, changes);
    },
    setScopeSnapshot(key: string, snapshot: ScopeCacheSnapshot): void {
      this.scopeCache[key] = snapshot;
    },
    rememberForgottenId(id: string): void {
      this.forgottenConversationIds = [...this.forgottenConversationIds, id];
    },
  },
});
