import type { ConversationListItem } from '../services/historyApiService';
export interface ScopeCacheSnapshot {
  conversations: ConversationListItem[];
  nextCursor?: string;
  hasMore: boolean;
  isComplete: boolean;
  isLoading: boolean;
  error: string | null;
  lastRefreshTime: number;
  searchQuery: string;
}
export interface LoadScopeListOptions {
  refresh?: boolean;
  loadAll?: boolean;
  limit?: number;
  search?: string;
}
export type HistoryListCurrentState = Omit<ScopeCacheSnapshot, 'isComplete'>;
export interface HistoryListState extends HistoryListCurrentState {
  scopeCache: Record<string, ScopeCacheSnapshot>;
  forgottenConversationIds: string[];
}
