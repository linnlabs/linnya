import { watch } from 'vue';
import { useFileStore } from '@/app/active-document';
import {
  closeDocumentTabs,
  closeDocumentTabsToRight,
  closeOtherDocumentTabs,
  cycleRecentDocumentTab,
  openDocumentTab,
  popClosedDocumentTab,
  removeDocumentTabs,
  useDocumentTabsStore,
  type DocumentTab,
  type DocumentTabsCloseResult,
  type DocumentTabsState,
} from '@/app/document-tabs';
import { useLayoutStore } from '@/app/layout/store/layoutStore';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';

/**
 * 文档标签与文档导航的编排：任何来源打开文档都记进当前项目的标签；
 * 点标签、关标签、重新打开都回到正式文档导航，不另走一条打开链。
 */

function openTab(tab: DocumentTab): Promise<void> {
  return getWorkspaceNavigationPort().openDocument({
    documentId: tab.id,
    type: tab.type,
    projectId: tab.projectId,
    displayName: tab.displayName,
    parentId: tab.parentId,
  });
}

/** 关闭后：当前标签被关且还有剩余就切到最近用过的，一个不剩就关掉文档区域。 */
async function applyCloseResult(projectId: string, result: DocumentTabsCloseResult): Promise<void> {
  useDocumentTabsStore().update(projectId, () => result.state);
  if (!result.activeClosed) return;
  if (result.nextActive) {
    await openTab(result.nextActive);
    return;
  }
  const layoutStore = useLayoutStore();
  if (layoutStore.state.activeDocument?.projectId === projectId) {
    await getWorkspaceNavigationPort().closeWorkspaceDocument();
  }
}

function readState(projectId: string): DocumentTabsState {
  return useDocumentTabsStore().stateFor(projectId);
}

export function activateDocumentTab(tab: DocumentTab): Promise<void> {
  return openTab(tab);
}

export function closeDocumentTabIds(projectId: string, ids: readonly string[]): Promise<void> {
  return applyCloseResult(projectId, closeDocumentTabs(readState(projectId), ids));
}

export function closeOtherDocumentTabIds(projectId: string, keepId: string): Promise<void> {
  // 保留的标签不是当前标签时，当前标签随之关闭，剩下的唯一一个就是它。
  return applyCloseResult(projectId, closeOtherDocumentTabs(readState(projectId), keepId));
}

export function closeDocumentTabIdsToRight(projectId: string, id: string): Promise<void> {
  return applyCloseResult(projectId, closeDocumentTabsToRight(readState(projectId), id));
}

export async function reopenClosedDocumentTab(projectId: string): Promise<void> {
  const { state, tab } = popClosedDocumentTab(readState(projectId));
  const store = useDocumentTabsStore();
  store.update(projectId, () => state);
  if (!tab) return;
  await openTab(tab);
}

export async function cycleDocumentTab(projectId: string, offset: 1 | -1): Promise<void> {
  const tab = cycleRecentDocumentTab(readState(projectId), offset);
  if (tab) await openTab(tab);
}

/** 文档被删除：去掉它们的标签；删的是当前文档时返回接下来要打开的标签。 */
export function removeDeletedDocumentTabs(
  projectId: string,
  removedIds: ReadonlySet<string>,
  activeDocumentWasRemoved: boolean,
): DocumentTab | null {
  const store = useDocumentTabsStore();
  const next = removeDocumentTabs(store.stateFor(projectId), [...removedIds]);
  store.update(projectId, () => next);
  if (!activeDocumentWasRemoved) return null;
  const nextId = next.recent[0] ?? next.tabs[0]?.id;
  return next.tabs.find(tab => tab.id === nextId) ?? null;
}

/**
 * 应用壳挂载时调用一次：活动文档变化记成标签，名字跟随文件会话。
 */
export function installDocumentTabsSync(): void {
  const layoutStore = useLayoutStore();
  const fileStore = useFileStore();
  const store = useDocumentTabsStore();

  watch(
    () => layoutStore.state.activeDocument,
    (document) => {
      if (!document) return;
      const displayName = fileStore.currentFilePath === document.id ? fileStore.fileDisplayName || null : null;
      store.update(document.projectId, state => openDocumentTab(state, {
        id: document.id,
        type: document.type,
        projectId: document.projectId,
        displayName,
        parentId: state.tabs.find(tab => tab.id === document.id)?.parentId ?? null,
      }));
    },
    { immediate: true },
  );

  watch(
    () => [fileStore.currentFilePath, fileStore.fileDisplayName] as const,
    ([documentId, displayName]) => {
      const document = layoutStore.state.activeDocument;
      if (!document || document.id !== documentId || !displayName) return;
      store.update(document.projectId, (state) => {
        const tab = state.tabs.find(item => item.id === documentId);
        if (!tab || tab.displayName === displayName) return state;
        return { ...state, tabs: state.tabs.map(item => (item.id === documentId ? { ...item, displayName } : item)) };
      });
    },
  );
}
