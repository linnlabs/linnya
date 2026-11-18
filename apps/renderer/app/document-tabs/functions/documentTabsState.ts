import type {
  DocumentTab,
  DocumentTabIdentity,
  DocumentTabsCloseResult,
  DocumentTabsState,
} from '../definitions/documentTabs';

/** “重新打开刚关闭的”最多回溯的条数；只在内存里，重启不恢复。 */
export const DOCUMENT_TABS_CLOSED_LIMIT = 20;

export function createDocumentTabsState(): DocumentTabsState {
  return { tabs: [], recent: [], closed: [] };
}

function withRecent(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter(item => item !== id)];
}

/** 新标签插在当前标签右侧；还没有当前标签时放在末尾。 */
function insertAfterActive(state: DocumentTabsState, tab: DocumentTab): DocumentTab[] {
  const activeIndex = state.tabs.findIndex(item => item.id === state.recent[0]);
  if (activeIndex < 0) return [...state.tabs, tab];
  return [...state.tabs.slice(0, activeIndex + 1), tab, ...state.tabs.slice(activeIndex + 1)];
}

/**
 * 记录一次打开。已打开的文档只刷新信息并激活；新文档默认是临时标签，
 * 替换已有的临时标签（位置不变），pin 时直接固定。
 */
export function openDocumentTab(
  state: DocumentTabsState,
  identity: DocumentTabIdentity,
  options: { readonly pin?: boolean } = {},
): DocumentTabsState {
  const existing = state.tabs.find(tab => tab.id === identity.id);
  if (existing) {
    const updated: DocumentTab = {
      ...existing,
      ...identity,
      displayName: identity.displayName ?? existing.displayName,
      preview: existing.preview && !options.pin,
    };
    return {
      ...state,
      tabs: state.tabs.map(tab => (tab.id === identity.id ? updated : tab)),
      recent: withRecent(state.recent, identity.id),
    };
  }

  const tab: DocumentTab = { ...identity, preview: !options.pin };
  const previewIndex = options.pin ? -1 : state.tabs.findIndex(item => item.preview);
  if (previewIndex >= 0) {
    const replacedId = state.tabs[previewIndex]!.id;
    const tabs = [...state.tabs];
    tabs.splice(previewIndex, 1, tab);
    return {
      ...state,
      tabs,
      recent: withRecent(state.recent.filter(item => item !== replacedId), tab.id),
    };
  }
  return { ...state, tabs: insertAfterActive(state, tab), recent: withRecent(state.recent, tab.id) };
}

export function pinDocumentTab(state: DocumentTabsState, id: string): DocumentTabsState {
  if (!state.tabs.some(tab => tab.id === id && tab.preview)) return state;
  return { ...state, tabs: state.tabs.map(tab => (tab.id === id ? { ...tab, preview: false } : tab)) };
}

/**
 * 关闭若干标签。关闭的是当前标签时，下一个当前标签取最近使用的剩余标签；
 * 没有剩余标签时 nextActive 为 null，调用方负责关掉文档区域。
 */
export function closeDocumentTabs(state: DocumentTabsState, ids: readonly string[]): DocumentTabsCloseResult {
  const closing = new Set(ids);
  const closedTabs = state.tabs.filter(tab => closing.has(tab.id));
  if (!closedTabs.length) return { state, activeClosed: false, nextActive: null };

  const activeId = state.recent[0] ?? null;
  const tabs = state.tabs.filter(tab => !closing.has(tab.id));
  const recent = state.recent.filter(id => !closing.has(id));
  const closed = [...state.closed, ...closedTabs].slice(-DOCUMENT_TABS_CLOSED_LIMIT);
  const activeClosed = activeId !== null && closing.has(activeId);
  const nextActiveId = activeClosed ? (recent[0] ?? tabs[0]?.id ?? null) : null;
  return {
    state: { tabs, recent, closed },
    activeClosed,
    nextActive: nextActiveId ? tabs.find(tab => tab.id === nextActiveId) ?? null : null,
  };
}

export function closeOtherDocumentTabs(state: DocumentTabsState, keepId: string): DocumentTabsCloseResult {
  return closeDocumentTabs(state, state.tabs.filter(tab => tab.id !== keepId).map(tab => tab.id));
}

export function closeDocumentTabsToRight(state: DocumentTabsState, id: string): DocumentTabsCloseResult {
  const index = state.tabs.findIndex(tab => tab.id === id);
  if (index < 0) return { state, activeClosed: false, nextActive: null };
  return closeDocumentTabs(state, state.tabs.slice(index + 1).map(tab => tab.id));
}

/** 取出最近关闭、且当前没在标签栏里的那个；重新打开时作为固定标签。 */
export function popClosedDocumentTab(state: DocumentTabsState): { state: DocumentTabsState; tab: DocumentTab | null } {
  const closed = [...state.closed];
  while (closed.length) {
    const tab = closed.pop()!;
    if (!state.tabs.some(item => item.id === tab.id)) return { state: { ...state, closed }, tab };
  }
  return { state: { ...state, closed }, tab: null };
}

/** 文档被删除时移除标签，不进入“重新打开”记录。 */
export function removeDocumentTabs(state: DocumentTabsState, ids: readonly string[]): DocumentTabsState {
  const removing = new Set(ids);
  return {
    tabs: state.tabs.filter(tab => !removing.has(tab.id)),
    recent: state.recent.filter(id => !removing.has(id)),
    closed: state.closed.filter(tab => !removing.has(tab.id)),
  };
}

/** Ctrl+Tab：按最近使用顺序循环；offset 为 1 是上一个用过的，-1 反向。 */
export function cycleRecentDocumentTab(state: DocumentTabsState, offset: 1 | -1): DocumentTab | null {
  const ordered = state.recent.filter(id => state.tabs.some(tab => tab.id === id));
  if (ordered.length < 2) return null;
  const nextId = ordered[(offset + ordered.length) % ordered.length]!;
  return state.tabs.find(tab => tab.id === nextId) ?? null;
}
