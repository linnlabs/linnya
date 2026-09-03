import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { getRendererPersistStorage } from '@/shared/persistence/rendererPersistStorage';

function normalizeProjectIds(projectIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const projectId of projectIds) {
    const trimmedProjectId = projectId.trim();
    if (!trimmedProjectId || seen.has(trimmedProjectId)) continue;
    seen.add(trimmedProjectId);
    normalized.push(trimmedProjectId);
  }

  return normalized;
}

export const useSidebarProjectExpansionStore = defineStore('workspace-sidebar-project-expansion', () => {
  const expandedProjectIds = ref<string[]>([]);
  const expandedProjectIdSet = computed(() => new Set(expandedProjectIds.value));

  function isProjectExpanded(projectId: string): boolean {
    return expandedProjectIdSet.value.has(projectId);
  }

  function expandProject(projectId: string): void {
    expandedProjectIds.value = normalizeProjectIds([...expandedProjectIds.value, projectId]);
  }

  function collapseProject(projectId: string): void {
    expandedProjectIds.value = expandedProjectIds.value.filter((id) => id !== projectId);
  }

  function toggleProject(projectId: string): void {
    if (isProjectExpanded(projectId)) {
      collapseProject(projectId);
      return;
    }
    expandProject(projectId);
  }

  function retainExistingProjects(existingProjectIds: readonly string[]): void {
    const existingIdSet = new Set(normalizeProjectIds(existingProjectIds));
    expandedProjectIds.value = expandedProjectIds.value.filter((projectId) => existingIdSet.has(projectId));
  }

  return {
    expandedProjectIds,
    isProjectExpanded,
    expandProject,
    collapseProject,
    toggleProject,
    retainExistingProjects,
  };
}, {
  persist: {
    key: 'workspace-sidebar-project-expansion',
    storage: getRendererPersistStorage(),
    pick: ['expandedProjectIds'],
  },
});
