import { ref } from 'vue';
import { defineStore } from 'pinia';

interface OpenProjectOverviewModalParams {
  projectId: string;
  projectName?: string | null;
}

export const useProjectOverviewModalStore = defineStore('workspace-project-overview-modal', () => {
  const visible = ref(false);
  const projectId = ref<string | null>(null);
  const projectName = ref<string | null>(null);

  function open(params: OpenProjectOverviewModalParams): void {
    const normalizedProjectId = params.projectId.trim();
    if (!normalizedProjectId) return;

    projectId.value = normalizedProjectId;
    projectName.value = params.projectName ?? null;
    visible.value = true;
  }

  function close(): void {
    visible.value = false;
    projectId.value = null;
    projectName.value = null;
  }

  return {
    visible,
    projectId,
    projectName,
    open,
    close,
  };
});
