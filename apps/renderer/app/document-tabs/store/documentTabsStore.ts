import { defineStore } from 'pinia';
import { shallowRef } from 'vue';
import type { DocumentTabsState } from '../definitions/documentTabs';
import { createDocumentTabsState, pinDocumentTab } from '../functions/documentTabsState';

const EMPTY_STATE: DocumentTabsState = createDocumentTabsState();

/**
 * 每个项目各自一组已打开的文档标签。只在内存里，重启不恢复；
 * 状态变换全部由 functions/documentTabsState 的纯函数完成，这里只按项目存取。
 */
export const useDocumentTabsStore = defineStore('document-tabs', () => {
  const byProject = shallowRef<Readonly<Record<string, DocumentTabsState>>>({});

  function stateFor(projectId: string | null): DocumentTabsState {
    if (!projectId) return EMPTY_STATE;
    return byProject.value[projectId] ?? EMPTY_STATE;
  }

  function update(projectId: string, transform: (state: DocumentTabsState) => DocumentTabsState): void {
    const current = stateFor(projectId);
    const next = transform(current);
    if (next === current) return;
    byProject.value = { ...byProject.value, [projectId]: next };
  }

  /** 双击侧栏条目时文档可能还在打开途中：标签已在就固定，不在就等它出现时固定。 */
  const pendingPinIds = new Set<string>();

  function requestPin(projectId: string | null, documentId: string): void {
    if (!projectId) return;
    if (!stateFor(projectId).tabs.some(tab => tab.id === documentId)) {
      pendingPinIds.add(documentId);
      return;
    }
    update(projectId, state => pinDocumentTab(state, documentId));
  }

  /** 记录打开时取走待固定标记。 */
  function takePendingPin(documentId: string): boolean {
    return pendingPinIds.delete(documentId);
  }

  function forgetProject(projectId: string): void {
    if (!(projectId in byProject.value)) return;
    const rest = { ...byProject.value };
    delete rest[projectId];
    byProject.value = rest;
  }

  return { byProject, stateFor, update, forgetProject, requestPin, takePendingPin };
});
