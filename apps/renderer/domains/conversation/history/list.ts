import { useHistoryListState } from './store/historyListStore';
import { createHistoryListRuntime } from './orchestration/createHistoryListRuntime';
const runtimes = new WeakMap<
  ReturnType<typeof useHistoryListState>,
  ReturnType<typeof createHistoryListFacade>
>();
export function useHistoryList() {
  const state = useHistoryListState();
  let runtime = runtimes.get(state);
  if (!runtime) {
    runtime = createHistoryListFacade(state);
    runtimes.set(state, runtime);
  }
  return runtime;
}
function createHistoryListFacade(state: ReturnType<typeof useHistoryListState>) {
  const runtime = createHistoryListRuntime(state);
  return {
    ...runtime,
    get conversations() {
      return state.conversations;
    },
    get isLoading() {
      return state.isLoading;
    },
    get error() {
      return state.error;
    },
    get nextCursor() {
      return state.nextCursor;
    },
    get hasMore() {
      return state.hasMore;
    },
    get searchQuery() {
      return state.searchQuery;
    },
    get lastRefreshTime() {
      return state.lastRefreshTime;
    },
    get scopeCache() {
      return state.scopeCache;
    },
    get forgottenConversationIds() {
      return state.forgottenConversationIds;
    },
    getConversationsByScope: state.getConversationsByScope,
    isLoadingByScope: state.isLoadingByScope,
    errorByScope: state.errorByScope,
    hasLoadedScope: state.hasLoadedScope,
    isScopeComplete: state.isScopeComplete,
  };
}
