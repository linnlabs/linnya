import { computed, ref } from 'vue';
import type { Project } from '@/domains/workspace/store';
import { isProjectDeleteDisabled } from '@/domains/workspace/ui/sidebar';
import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';

interface UseWorkspaceSidebarProjectDeleteOptions {
  getProjects: () => Project[];
  deleteProject: (projectId: string) => Promise<void>;
  workspaceMessage: WorkspaceMessageResolver;
}

export function useSidebarProjectDelete(options: UseWorkspaceSidebarProjectDeleteOptions) {
  const showDeleteProjectDialog = ref(false);
  const pendingDeleteProjectId = ref<string | null>(null);
  const pendingDeleteProjectName = ref('');

  const deleteDialogMessage = computed(() => {
    if (!pendingDeleteProjectName.value) {
      return options.workspaceMessage('workspace.sidebar.project.delete.messageWithoutName');
    }
    return options.workspaceMessage('workspace.sidebar.project.delete.messageWithName', {
      projectName: pendingDeleteProjectName.value,
    });
  });

  async function handleDeleteProject(projectId: string): Promise<void> {
    const project = options.getProjects().find((item) => item.id === projectId);
    if (!project) return;
    if (isProjectDeleteDisabled(project)) return;

    pendingDeleteProjectId.value = projectId;
    pendingDeleteProjectName.value = project.name;
    showDeleteProjectDialog.value = true;
  }

  async function handleConfirmDeleteProject(): Promise<void> {
    const projectId = pendingDeleteProjectId.value;
    if (!projectId) {
      showDeleteProjectDialog.value = false;
      return;
    }

    try {
      await options.deleteProject(projectId);
    } finally {
      resetDeleteDialog();
    }
  }

  function handleCancelDeleteProject(): void {
    resetDeleteDialog();
  }

  function resetDeleteDialog(): void {
    showDeleteProjectDialog.value = false;
    pendingDeleteProjectId.value = null;
    pendingDeleteProjectName.value = '';
  }

  return {
    showDeleteProjectDialog,
    deleteDialogMessage,
    handleDeleteProject,
    handleConfirmDeleteProject,
    handleCancelDeleteProject,
  };
}
