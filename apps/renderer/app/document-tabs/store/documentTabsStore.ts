import { defineStore } from 'pinia';
import { shallowRef } from 'vue';
import type { DocumentTabsState } from '../definitions/documentTabs';
import { createDocumentTabsState } from '../functions/documentTabsState';

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

  function forgetProject(projectId: string): void {
    if (!(projectId in byProject.value)) return;
    const rest = { ...byProject.value };
    delete rest[projectId];
    byProject.value = rest;
  }

  return { byProject, stateFor, update, forgetProject };
});
